-- =====================================================================
-- Suministro Enel · AVISOS por cliente (para pedir priorización a Enel)
-- ---------------------------------------------------------------------
-- Requiere haber ejecutado antes 2026-10-suministro-enel.sql y
-- 2026-10-suministro-interruptor.sql. Se puede ejecutar más de una vez.
--
-- Agrega el archivo "me-capa-avisos" de Enel (un punto por aviso de cliente) y
-- guarda SOLO los avisos que caen dentro de La Florida, con los datos que Enel
-- pide para priorizar un trabajo: N.° de caso (incidencia), N.° de aviso,
-- N.° de cliente y dirección.
--
-- Privacidad:
--  · Los avisos contienen datos de clientes (N.° de cliente y dirección). Solo
--    pueden leerlos admin, ito e ito2 (lo exige la base, no solo la pantalla).
--  · No se guarda historial: la tabla se reemplaza completa en cada lectura.
--  · El interruptor de Ajustes también apaga esta lectura.
-- =====================================================================

create table if not exists public.suministro_avisos (
  cod_aviso      bigint primary key,
  incidencia     text,            -- N.° de caso (ej. DF202671833584)
  direccion      text,
  numero_cliente text,
  falla          text,
  inicio         text,
  reposicion     text,
  alimentador    text,
  lon            double precision not null,
  lat            double precision not null,
  actualizado_en timestamptz not null default now()
);

alter table public.suministro_peticiones add column if not exists req_avisos bigint;

alter table public.suministro_avisos enable row level security;
drop policy if exists suministro_avisos_lee on public.suministro_avisos;
create policy suministro_avisos_lee on public.suministro_avisos for select to authenticated
  using (public.mi_rol() in ('admin', 'ito', 'ito2'));
revoke all on public.suministro_avisos from anon, authenticated;
grant select on public.suministro_avisos to authenticated;

-- ---------- Paso 1: pedir los archivos (ahora también el de avisos) ----------
create or replace function public.suministro_solicitar()
returns void language plpgsql security definer set search_path = public, extensions, net as $$
declare r1 bigint; r2 bigint; r3 bigint;
begin
  if not coalesce((select activo from public.suministro_config where id = 1), true) then
    return;   -- apagado por el administrador
  end if;
  r1 := net.http_get('https://mapaemergencia.enel.com/galeria/documento/me-capa-comunasAfectadas.txt', timeout_milliseconds := 30000);
  r2 := net.http_get('https://mapaemergencia.enel.com/galeria/documento/me-capa-trafosAfectados.txt',  timeout_milliseconds := 60000);
  r3 := net.http_get('https://mapaemergencia.enel.com/galeria/documento/me-capa-avisos.txt',           timeout_milliseconds := 60000);
  update public.suministro_peticiones
     set req_comunas = r1, req_trafos = r2, req_avisos = r3, solicitado_en = now(), procesado = false, error = null
   where id = 1;
  begin
    delete from cron.job_run_details where end_time < now() - interval '2 days';
  exception when others then null;
  end;
end $$;
revoke all on function public.suministro_solicitar() from public, anon, authenticated;

-- ---------- Paso 2: leer las respuestas y guardar lo de La Florida ----------
create or replace function public.suministro_procesar()
returns void language plpgsql security definer set search_path = public, extensions, net as $$
declare
  p public.suministro_peticiones%rowtype;
  rc record; rt record; ra record;
  jc jsonb; jt jsonb; ja jsonb;
  fl jsonb; geom jsonb;
  x0 double precision := -180; x1 double precision := 180; y0 double precision := -90; y1 double precision := 90;
begin
  select * into p from public.suministro_peticiones where id = 1;
  if p.procesado or p.req_comunas is null then return; end if;

  select status_code, content, error_msg into rc from net._http_response where id = p.req_comunas;
  select status_code, content, error_msg into rt from net._http_response where id = p.req_trafos;
  select status_code, content, error_msg into ra from net._http_response where id = p.req_avisos;
  if rc is null or rt is null or (p.req_avisos is not null and ra is null) then
    if p.solicitado_en < now() - interval '5 minutes' then
      update public.suministro_peticiones set procesado = true, error = 'Sin respuesta de Enel' where id = 1;
    end if;
    return;
  end if;

  begin
    if rc.status_code is distinct from 200 or rt.status_code is distinct from 200 or (p.req_avisos is not null and ra.status_code is distinct from 200) then
      raise exception 'Enel respondió % / % / % (%)', rc.status_code, rt.status_code, ra.status_code, coalesce(rc.error_msg, rt.error_msg, ra.error_msg, '');
    end if;
    jc := rc.content::jsonb;
    jt := rt.content::jsonb;

    select f into fl from jsonb_array_elements(jc->'features') f
     where f->'properties'->>'COMUNA' = 'LA_FLORIDA' limit 1;
    if fl is null then raise exception 'La Florida no aparece en el archivo de comunas'; end if;
    geom := fl->'geometry';

    -- Rectángulo del contorno (solo para descartar rápido lo que está lejos)
    if geom->>'type' = 'Polygon' then
      select min((v->>0)::double precision), max((v->>0)::double precision), min((v->>1)::double precision), max((v->>1)::double precision)
        into x0, x1, y0, y1 from jsonb_array_elements(geom->'coordinates'->0) v;
    end if;

    insert into public.suministro_enel as s (id, comuna, clientes_total, clientes_afectados, porcentaje, hora_enel, actualizado_en)
    values (1, 'La Florida',
            nullif(trim(fl->'properties'->>'CLIENTESTOTAL'), '')::int,
            nullif(trim(fl->'properties'->>'CLIENTESAFECTADOS'), '')::int,
            nullif(trim(fl->'properties'->>'PORCENTAJE'), '')::numeric,
            null, now())
    on conflict (id) do update set comuna = excluded.comuna, clientes_total = excluded.clientes_total,
      clientes_afectados = excluded.clientes_afectados, porcentaje = excluded.porcentaje, actualizado_en = now();

    delete from public.suministro_trafos;
    insert into public.suministro_trafos (numpos, incidencia, clientes, avisos, inicio, reposicion, estado, alimentador, lon, lat)
    select distinct on (numpos, incidencia) numpos, incidencia, clientes, avisos, inicio, reposicion, estado, alimentador, lon, lat
    from (
      select f->'properties'->>'numpos' as numpos,
             coalesce(f->'properties'->>'INCIDENCIA', '') as incidencia,
             nullif(trim(f->'properties'->>'CLITOTAL'), '')::int as clientes,
             nullif(trim(f->'properties'->>'CANTAVISOS'), '')::int as avisos,
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
    where lon between x0 and x1 and lat between y0 and y1
      and public.suministro_en_poligono(lon, lat, geom);

    -- Avisos de clientes dentro de La Florida (se reemplaza todo en cada lectura; sin historial)
    if p.req_avisos is not null then
      ja := ra.content::jsonb;
      delete from public.suministro_avisos;
      insert into public.suministro_avisos (cod_aviso, incidencia, direccion, numero_cliente, falla, inicio, reposicion, alimentador, lon, lat)
      select distinct on (cod_aviso) cod_aviso, incidencia, direccion, numero_cliente, falla, inicio, reposicion, alimentador, lon, lat
      from (
        select nullif(f->'properties'->>'COD_AVISO', '')::bigint as cod_aviso,
               nullif(trim(f->'properties'->>'CODIGO'), '') as incidencia,
               nullif(trim(f->'properties'->>'DIRECCION'), '') as direccion,
               nullif(trim(f->'properties'->>'numero_cliente'), '') as numero_cliente,
               nullif(trim(f->'properties'->>'FALLA'), '') as falla,
               nullif(trim(f->'properties'->>'FECHA_INI'), '') as inicio,
               nullif(trim(f->'properties'->>'FECHA_REPOSICION'), '') as reposicion,
               nullif(trim(f->'properties'->>'id_alim'), '') as alimentador,
               (f->'geometry'->'coordinates'->>0)::double precision as lon,
               (f->'geometry'->'coordinates'->>1)::double precision as lat
        from jsonb_array_elements(ja->'features') f
        where f->'geometry'->>'type' = 'Point'
      ) t
      where cod_aviso is not null and lon between x0 and x1 and lat between y0 and y1
        and public.suministro_en_poligono(lon, lat, geom);
    end if;

    update public.suministro_enel set hora_enel = to_char(now() at time zone 'America/Santiago', 'DD/MM HH24:MI') where id = 1;
    update public.suministro_peticiones set procesado = true, error = null where id = 1;
  exception when others then
    update public.suministro_peticiones set procesado = true, error = left(sqlerrm, 300) where id = 1;
  end;

  begin
    delete from net._http_response where id in (p.req_comunas, p.req_trafos, coalesce(p.req_avisos, -1));
  exception when others then null;
  end;
end $$;
revoke all on function public.suministro_procesar() from public, anon, authenticated;

-- Estado para Ajustes (solo admin): ahora también cuenta los avisos
create or replace function public.suministro_estado()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede ver esto.';
  end if;
  return jsonb_build_object(
    'activo',         coalesce((select activo from public.suministro_config where id = 1), true),
    'ultima_lectura', (select actualizado_en from public.suministro_enel where id = 1),
    'solicitado_en',  (select solicitado_en from public.suministro_peticiones where id = 1),
    'error',          (select error from public.suministro_peticiones where id = 1),
    'trafos',         (select count(*) from public.suministro_trafos),
    'avisos',         (select count(*) from public.suministro_avisos),
    'cada_min',       10);
end $$;
revoke all on function public.suministro_estado() from public, anon;
grant execute on function public.suministro_estado() to authenticated;

-- Primera carga inmediata (los datos aparecen en ~1 minuto)
select public.suministro_solicitar();
