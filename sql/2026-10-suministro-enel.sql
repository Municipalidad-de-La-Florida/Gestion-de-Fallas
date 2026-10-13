-- =====================================================================
-- Indicador de suministro eléctrico (Enel) + transformadores sin luz
-- ---------------------------------------------------------------------
-- Lee dos archivos públicos del Mapa de Emergencia de Enel cada 5 min:
--   · me-capa-comunasAfectadas.txt  → clientes sin luz de La Florida   (~190 KB)
--   · me-capa-trafosAfectados.txt   → transformadores sin luz de Enel  (~3,7 MB)
-- y guarda SOLO lo de La Florida en dos tablas pequeñas. La web y la app leen
-- esas tablas; nunca descargan los archivos de Enel.
--
-- Requiere las extensiones pg_net y pg_cron (ya instaladas en este proyecto).
-- No toca ninguna tabla existente. Se puede ejecutar más de una vez.
--
-- Para APAGARLO por completo:
--   select cron.unschedule('suministro-solicitar');
--   select cron.unschedule('suministro-procesar');
-- =====================================================================

-- ---------- 1. Tablas ----------
create table if not exists public.suministro_enel (
  id                 int primary key default 1 check (id = 1),   -- una sola fila
  comuna             text,
  clientes_total     int,
  clientes_afectados int,
  porcentaje         numeric,
  hora_enel          text,            -- hora en que este servidor leyó el dato de Enel (ej. '13/10 18:14')
  actualizado_en     timestamptz not null default now()
);

create table if not exists public.suministro_trafos (
  numpos       text not null,
  incidencia   text not null default '',
  clientes     int,
  inicio       text,
  reposicion   text,
  estado       text,
  alimentador  text,
  lon          double precision not null,
  lat          double precision not null,
  actualizado_en timestamptz not null default now(),
  primary key (numpos, incidencia)
);

-- Control interno de la petición en curso (una fila)
create table if not exists public.suministro_peticiones (
  id            int primary key default 1 check (id = 1),
  req_comunas   bigint,
  req_trafos    bigint,
  solicitado_en timestamptz,
  procesado     boolean not null default true,
  error         text
);
insert into public.suministro_peticiones (id) values (1) on conflict do nothing;

-- ---------- 2. Permisos: lectura para usuarios con sesión; nada más ----------
alter table public.suministro_enel        enable row level security;
alter table public.suministro_trafos      enable row level security;
alter table public.suministro_peticiones  enable row level security;

drop policy if exists suministro_enel_lee   on public.suministro_enel;
drop policy if exists suministro_trafos_lee on public.suministro_trafos;
create policy suministro_enel_lee   on public.suministro_enel   for select to authenticated using (true);
create policy suministro_trafos_lee on public.suministro_trafos for select to authenticated using (true);

revoke all on public.suministro_enel, public.suministro_trafos, public.suministro_peticiones from anon, authenticated;
grant select on public.suministro_enel, public.suministro_trafos to authenticated;

-- ---------- 3. Punto dentro de polígono (sin depender de PostGIS) ----------
-- p_geom: geometría GeoJSON (Polygon o MultiPolygon). Regla par-impar sobre el anillo exterior.
create or replace function public.suministro_en_poligono(p_lon double precision, p_lat double precision, p_geom jsonb)
returns boolean language plpgsql immutable as $$
declare
  polis jsonb; poli jsonb; anillo jsonb;
  n int; i int; j int; dentro boolean;
  xi double precision; yi double precision; xj double precision; yj double precision;
begin
  if p_geom is null then return false; end if;
  polis := case p_geom->>'type' when 'MultiPolygon' then p_geom->'coordinates'
                                when 'Polygon' then jsonb_build_array(p_geom->'coordinates')
                                else '[]'::jsonb end;
  for poli in select * from jsonb_array_elements(polis) loop
    anillo := poli->0;
    n := jsonb_array_length(anillo);
    dentro := false;
    j := n - 1;
    for i in 0 .. n - 1 loop
      xi := (anillo->i->>0)::double precision; yi := (anillo->i->>1)::double precision;
      xj := (anillo->j->>0)::double precision; yj := (anillo->j->>1)::double precision;
      if ((yi > p_lat) <> (yj > p_lat)) and (p_lon < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) then
        dentro := not dentro;
      end if;
      j := i;
    end loop;
    if dentro then return true; end if;
  end loop;
  return false;
end $$;

-- ---------- 4. Paso 1: pedir los archivos a Enel (respuesta llega después) ----------
create or replace function public.suministro_solicitar()
returns void language plpgsql security definer set search_path = public, extensions, net as $$
declare r1 bigint; r2 bigint;
begin
  r1 := net.http_get('https://mapaemergencia.enel.com/galeria/documento/me-capa-comunasAfectadas.txt',
                     timeout_milliseconds := 30000);
  r2 := net.http_get('https://mapaemergencia.enel.com/galeria/documento/me-capa-trafosAfectados.txt',
                     timeout_milliseconds := 60000);
  update public.suministro_peticiones
     set req_comunas = r1, req_trafos = r2, solicitado_en = now(), procesado = false, error = null
   where id = 1;
  -- Mantenimiento: el historial de ejecuciones de pg_cron no crece sin límite
  begin
    delete from cron.job_run_details where end_time < now() - interval '2 days';
  exception when others then null;
  end;
end $$;

-- ---------- 5. Paso 2: leer las respuestas y guardar lo de La Florida ----------
create or replace function public.suministro_procesar()
returns void language plpgsql security definer set search_path = public, extensions, net as $$
declare
  p public.suministro_peticiones%rowtype;
  rc record; rt record;
  jc jsonb; jt jsonb;
  fl jsonb;
begin
  select * into p from public.suministro_peticiones where id = 1;
  if p.procesado or p.req_comunas is null then return; end if;

  select status_code, content, error_msg into rc from net._http_response where id = p.req_comunas;
  select status_code, content, error_msg into rt from net._http_response where id = p.req_trafos;
  if rc is null or rt is null then
    -- aún no llegan; si pasaron más de 5 min se da por fallida
    if p.solicitado_en < now() - interval '5 minutes' then
      update public.suministro_peticiones set procesado = true, error = 'Sin respuesta de Enel' where id = 1;
    end if;
    return;
  end if;

  begin
    if rc.status_code is distinct from 200 or rt.status_code is distinct from 200 then
      raise exception 'Enel respondió % / % (%)', rc.status_code, rt.status_code, coalesce(rc.error_msg, rt.error_msg, '');
    end if;
    jc := rc.content::jsonb;
    jt := rt.content::jsonb;

    -- La Florida: resumen + contorno
    select f into fl from jsonb_array_elements(jc->'features') f
     where f->'properties'->>'COMUNA' = 'LA_FLORIDA' limit 1;
    if fl is null then raise exception 'La Florida no aparece en el archivo de comunas'; end if;

    insert into public.suministro_enel as s (id, comuna, clientes_total, clientes_afectados, porcentaje, hora_enel, actualizado_en)
    values (1, 'La Florida',
            nullif(trim(fl->'properties'->>'CLIENTESTOTAL'), '')::int,
            nullif(trim(fl->'properties'->>'CLIENTESAFECTADOS'), '')::int,
            nullif(trim(fl->'properties'->>'PORCENTAJE'), '')::numeric,
            null, now())
    on conflict (id) do update set comuna = excluded.comuna, clientes_total = excluded.clientes_total,
      clientes_afectados = excluded.clientes_afectados, porcentaje = excluded.porcentaje, actualizado_en = now();

    -- Transformadores cuyo centro cae dentro del contorno de La Florida
    delete from public.suministro_trafos;
    insert into public.suministro_trafos (numpos, incidencia, clientes, inicio, reposicion, estado, alimentador, lon, lat)
    select distinct on (numpos, incidencia) numpos, incidencia, clientes, inicio, reposicion, estado, alimentador, lon, lat
    from (
      select f->'properties'->>'numpos' as numpos,
             coalesce(f->'properties'->>'INCIDENCIA', '') as incidencia,
             nullif(trim(f->'properties'->>'CLITOTAL'), '')::int as clientes,
             nullif(trim(f->'properties'->>'FECHA_INICIO'), '') as inicio,
             nullif(trim(f->'properties'->>'FECHA_REPOSICION'), '') as reposicion,
             nullif(trim(f->'properties'->>'ESTADOINC'), '') as estado,
             nullif(trim(f->'properties'->>'id_alim'), '') as alimentador,
             c.lon, c.lat
      from jsonb_array_elements(jt->'features') f
      cross join lateral (
        select avg((v->>0)::double precision) as lon, avg((v->>1)::double precision) as lat
        from jsonb_array_elements(f->'geometry'->'coordinates'->0) v
      ) c
      where f->'properties'->>'numpos' is not null and c.lon is not null
    ) t
    where public.suministro_en_poligono(lon, lat, fl->'geometry');

    -- Hora de lectura de este ciclo (la web y la app muestran actualizado_en)
    update public.suministro_enel set hora_enel = to_char(now() at time zone 'America/Santiago', 'DD/MM HH24:MI') where id = 1;
    update public.suministro_peticiones set procesado = true, error = null where id = 1;
  exception when others then
    update public.suministro_peticiones set procesado = true, error = left(sqlerrm, 300) where id = 1;
  end;

  -- Se borran las respuestas grandes de la cola de pg_net (si no, quedan 6 h ocupando espacio)
  begin
    delete from net._http_response where id in (p.req_comunas, p.req_trafos);
  exception when others then null;
  end;
end $$;

revoke all on function public.suministro_solicitar(), public.suministro_procesar() from public, anon, authenticated;

-- ---------- 6. Programación ----------
-- Pide los archivos cada 5 min; cada minuto revisa si ya llegaron (sale al instante si no hay nada pendiente).
select cron.unschedule(jobid) from cron.job where jobname in ('suministro-solicitar', 'suministro-procesar');
select cron.schedule('suministro-solicitar', '*/5 * * * *', $$select public.suministro_solicitar()$$);
select cron.schedule('suministro-procesar',  '* * * * *',   $$select public.suministro_procesar()$$);

-- Primera carga inmediata (los datos aparecen en ~1 minuto)
select public.suministro_solicitar();
