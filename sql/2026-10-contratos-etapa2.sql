-- Contratos, etapa 2a: el contrato de cada falla.
-- Agrega fallas.contrato_id (vacío por defecto, no cambia nada de lo que se ve hoy), lo hereda a los puntos
-- de un circuito, y lo expone en "Todas las fallas", la exportación y el mapa.
-- Re-ejecutable. Ejecutar ANTES de publicar el cambio del index.html.

alter table public.fallas add column if not exists contrato_id uuid references public.contratos(id) on delete set null;
create index if not exists fallas_contrato_idx on public.fallas (contrato_id);

-- Quién puede cambiar el contrato de una falla ya creada: admin, ITO y quienes ingresan fallas
-- (los contratistas, camiones y observadores no).
create or replace function public.proteger_contrato_falla()
returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.contrato_id is distinct from old.contrato_id and public.mi_rol() in ('contratista', 'camion', 'observador') then
    raise exception 'No tienes permiso para cambiar el contrato de una falla.';
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_proteger_contrato_falla on public.fallas;
create trigger trg_proteger_contrato_falla before update of contrato_id on public.fallas
  for each row execute function public.proteger_contrato_falla();

-- Un punto de cascada nace con el contrato de su circuito...
create or replace function public.heredar_contrato_cascada()
returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.cascada and new.contrato_id is null then
    select contrato_id into new.contrato_id from public.fallas where id = new.circuito_origen_id;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_heredar_contrato_cascada on public.fallas;
create trigger trg_heredar_contrato_cascada before insert on public.fallas
  for each row execute function public.heredar_contrato_cascada();

-- ...y lo sigue si después cambia el del circuito.
create or replace function public.propagar_contrato_cascada()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.tipo = 'linea' and new.contrato_id is distinct from old.contrato_id then
    update public.fallas set contrato_id = new.contrato_id where circuito_origen_id = new.id;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_propagar_contrato_cascada on public.fallas;
create trigger trg_propagar_contrato_cascada after update of contrato_id on public.fallas
  for each row execute function public.propagar_contrato_cascada();

-- ============ Todas las fallas (con contrato) ============
drop function if exists public.resumen_todas_fallas(integer, integer, text);
create function public.resumen_todas_fallas(limite integer default 500, desplazamiento integer default 0, busqueda text default null)
returns table(id uuid, ot text, orden_externa text, tipo text, tipo_falla text, estado text, fecha_creacion timestamptz, creado_en timestamptz, creado_por uuid, nombre_creador text, nombre_real_creador text, n_cliente text, llave integer, puntos_afectados integer, cardinalidad text, descripcion_otro text, reparado_por_nombre text, fecha_reparacion timestamptz, descripcion_reparacion text, pendiente_por_nombre text, fecha_pendiente timestamptz, motivo_pendiente text, masivo boolean,
  asignado_por_id uuid, asignado_por_nombre text, asignado_camion_nombre text, fecha_asignacion timestamptz,
  contrato_id uuid, contrato_nombre text)
language sql stable set search_path to 'public'
as $function$
  select
    f.id, f.ot, f.orden_externa, f.tipo, f.tipo_falla, f.estado, f.fecha_falla, f.fecha_falla_real, f.creado_por,
    ui.nombre as nombre_creador,
    ur2.nombre as nombre_real_creador,
    coalesce(p.n_cliente, c.n_cliente) as n_cliente,
    case when f.tipo = 'punto' then p.llave else null end as llave,
    case when f.tipo = 'punto' then 1
         else (select count(*)::integer from public.fallas fc where fc.circuito_origen_id = f.id)
    end as puntos_afectados,
    f.cardinalidad, f.descripcion_otro,
    ur.nombre as reparado_por_nombre, r.fecha_reparacion, r.descripcion as descripcion_reparacion,
    up.nombre as pendiente_por_nombre, f.fecha_pendiente, f.motivo_pendiente, f.masivo,
    f.asignado_por_id, ua.nombre as asignado_por_nombre, ucam.nombre as asignado_camion_nombre, f.fecha_asignacion,
    f.contrato_id, ct.nombre as contrato_nombre
  from public.fallas f
  left join (select id, nombre from public.usuarios union all select id, nombre from public.notificadores) ui on ui.id = coalesce(f.notificador_id, f.informado_por)
  left join public.usuarios ur2 on ur2.id = f.creado_por
  left join public.usuarios up on up.id = f.pendiente_por
  left join public.usuarios ua on ua.id = f.asignado_por_id
  left join public.usuarios ucam on ucam.id = f.asignado_camion_id
  left join public.contratos ct on ct.id = f.contrato_id
  left join public.puntos_luminarios p on p.gid = f.ref_punto_gid
  left join public.circuitos c on c.gid = f.ref_circuito_gid
  left join lateral (
    select * from public.reparaciones r2 where r2.falla_id = f.id order by r2.fecha_reparacion desc limit 1
  ) r on true
  left join public.usuarios ur on ur.id = r.reparado_por
  where f.cascada = false
    and (
      busqueda is null or btrim(busqueda) = ''
      or not exists (
        select 1
        from unnest(regexp_split_to_array(translate(lower(btrim(busqueda)), 'áéíóúüñ', 'aeiouun'), '\s+')) as t(term)
        where t.term <> ''
          and position(t.term in translate(lower(concat_ws(' ',
                f.ot, f.orden_externa, f.tipo_falla, coalesce(p.n_cliente, c.n_cliente),
                case when f.tipo = 'punto' then p.llave end,
                case when f.tipo = 'punto' then 'punto' else 'circuito' end,
                ui.nombre,
                case when public.mi_rol() = 'admin' then ur2.nombre end,
                ua.nombre, ucam.nombre, ct.nombre,
                replace(f.estado, '_', ' '),
                to_char(f.fecha_falla at time zone 'America/Santiago', 'DD/MM/YYYY HH24:MI'),
                to_char(f.fecha_falla at time zone 'America/Santiago', 'DD-MM-YYYY, HH24:MI'),
                case when f.tipo = 'punto' then '1' else (select count(*) from public.fallas fc where fc.circuito_origen_id = f.id)::text end
              )), 'áéíóúüñ', 'aeiouun')) = 0
      )
    )
  order by f.fecha_falla desc, f.id
  limit limite offset desplazamiento;
$function$;


-- ============ Exportación (con contrato) ============
drop function if exists public.resumen_fallas_exportar(timestamptz, timestamptz, text, uuid[]);
create function public.resumen_fallas_exportar(fecha_inicio timestamptz default null, fecha_fin timestamptz default null, tipo_fecha text default 'informada', asignadores uuid[] default null)
returns table(id uuid, ot text, orden_externa text, tipo text, tipo_falla text, estado text, fecha_creacion timestamptz, nombre_creador text, n_cliente text, llave integer, nro_mun integer, simb_poste text, puntos_afectados integer, reparado_por_nombre text, fecha_reparacion timestamptz, descripcion_reparacion text, pendiente_por_nombre text, fecha_pendiente timestamptz, motivo_pendiente text, fecha_creacion_real timestamptz, nombre_real_creador text,
  masivo boolean, asignado_por_id uuid, asignado_por_nombre text, asignado_camion_nombre text, fecha_asignacion timestamptz,
  contrato_id uuid, contrato_nombre text)
language sql stable set search_path to 'public'
as $function$
  select
    f.id, f.ot, f.orden_externa, f.tipo, f.tipo_falla, f.estado, f.fecha_falla,
    ui.nombre as nombre_creador,
    coalesce(p.n_cliente, c.n_cliente) as n_cliente,
    case when f.tipo = 'punto' then p.llave else null end as llave,
    case when f.tipo = 'punto' then p.nro_mun else null end as nro_mun,
    case when f.tipo = 'punto' then p.simb_poste else null end as simb_poste,
    case when f.tipo = 'punto' then 1
         else (select count(*)::integer from public.fallas fc where fc.circuito_origen_id = f.id)
    end as puntos_afectados,
    ur.nombre as reparado_por_nombre, r.fecha_reparacion, r.descripcion as descripcion_reparacion,
    up.nombre as pendiente_por_nombre, f.fecha_pendiente, f.motivo_pendiente,
    f.fecha_falla_real, ur2.nombre as nombre_real_creador,
    f.masivo, f.asignado_por_id, ua.nombre as asignado_por_nombre, ucam.nombre as asignado_camion_nombre, f.fecha_asignacion,
    f.contrato_id, ct.nombre as contrato_nombre
  from public.fallas f
  left join (select id, nombre from public.usuarios union all select id, nombre from public.notificadores) ui on ui.id = coalesce(f.notificador_id, f.informado_por)
  left join public.usuarios ur2 on ur2.id = f.creado_por
  left join public.usuarios up on up.id = f.pendiente_por
  left join public.usuarios ua on ua.id = f.asignado_por_id
  left join public.usuarios ucam on ucam.id = f.asignado_camion_id
  left join public.contratos ct on ct.id = f.contrato_id
  left join public.puntos_luminarios p on p.gid = f.ref_punto_gid
  left join public.circuitos c on c.gid = f.ref_circuito_gid
  left join lateral (
    select * from public.reparaciones r2 where r2.falla_id = f.id order by r2.fecha_reparacion desc limit 1
  ) r on true
  left join public.usuarios ur on ur.id = r.reparado_por
  where f.cascada = false
    and (asignadores is null or f.asignado_por_id = any(asignadores))
    and (
      (fecha_inicio is null and fecha_fin is null)
      or (case tipo_fecha
            when 'reparacion' then r.fecha_reparacion
            when 'asignacion' then f.fecha_asignacion
            else f.fecha_falla end)
         between coalesce(fecha_inicio, '-infinity'::timestamptz) and coalesce(fecha_fin, 'infinity'::timestamptz)
    )
  order by f.fecha_falla desc;
$function$;

-- ============ Mapa de fallas activas (con contrato) ============
create or replace function public.fallas_geojson(p_id uuid default null)
returns jsonb
language sql stable set search_path to 'public'
as $function$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(feat), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'type','Feature',
      'geometry', ST_AsGeoJSON(p.geom)::jsonb,
      'properties', jsonb_build_object(
        'id', f.id, 'ot', f.ot, 'orden_externa', f.orden_externa, 'tipo', f.tipo, 'tipo_falla', f.tipo_falla,
        'masivo', f.masivo, 'contrato_id', f.contrato_id, 'estado', f.estado, 'cascada', f.cascada, 'cardinalidad', f.cardinalidad,
        'fecha_falla', f.fecha_falla, 'nombre_creador', ui.nombre,
        'nombre_real_creador', ur2.nombre,
        'puntos_afectados', 1,
        'llave', p.llave, 'nro_mun', p.nro_mun, 'simb_poste', p.simb_poste,
        'ref_punto_gid', f.ref_punto_gid, 'ref_circuito_gid', f.ref_circuito_gid,
        'creado_por', f.creado_por, 'fecha_falla_real', f.fecha_falla_real,
        'reparado_por_nombre', r.reparado_por_nombre,
        'fecha_reparacion', r.fecha_reparacion,
        'descripcion_reparacion', r.descripcion,
        'pendiente_por_nombre', up.nombre,
        'fecha_pendiente', f.fecha_pendiente,
        'motivo_pendiente', f.motivo_pendiente,
        'asignado_camion_id', f.asignado_camion_id,
        'asignado_camion_nombre', uc.nombre,
        'asignado_por_id', f.asignado_por_id,
        'asignado_por_nombre', uap.nombre,
        'fecha_asignacion', f.fecha_asignacion
      )
    ) as feat
    from public.fallas f
    left join (select id, nombre from public.usuarios union all select id, nombre from public.notificadores) ui on ui.id = coalesce(f.notificador_id, f.informado_por)
    left join public.usuarios ur2 on ur2.id = f.creado_por
    left join public.usuarios up on up.id = f.pendiente_por
    left join public.usuarios uc on uc.id = f.asignado_camion_id
    left join public.usuarios uap on uap.id = f.asignado_por_id
    join public.puntos_luminarios p on p.gid = f.ref_punto_gid
    left join lateral (
      select r2.fecha_reparacion, r2.descripcion, ur.nombre as reparado_por_nombre
      from public.reparaciones r2
      left join public.usuarios ur on ur.id = r2.reparado_por
      where r2.falla_id = f.id
      order by r2.fecha_reparacion desc limit 1
    ) r on true
    where f.tipo = 'punto'
      and ((p_id is not null and f.id = p_id) or (p_id is null and (f.estado <> 'reparada' or r.fecha_reparacion > (now() - interval '16 hours'))))

    union all

    select jsonb_build_object(
      'type','Feature',
      'geometry', ST_AsGeoJSON(c.geom)::jsonb,
      'properties', jsonb_build_object(
        'id', f.id, 'ot', f.ot, 'orden_externa', f.orden_externa, 'tipo', f.tipo, 'tipo_falla', f.tipo_falla,
        'masivo', f.masivo, 'contrato_id', f.contrato_id, 'estado', f.estado, 'cascada', f.cascada, 'cardinalidad', f.cardinalidad,
        'fecha_falla', f.fecha_falla, 'nombre_creador', ui.nombre,
        'nombre_real_creador', ur2.nombre,
        'puntos_afectados', (select count(*)::integer from public.fallas fc where fc.circuito_origen_id = f.id),
        'ref_punto_gid', f.ref_punto_gid, 'ref_circuito_gid', f.ref_circuito_gid,
        'creado_por', f.creado_por, 'fecha_falla_real', f.fecha_falla_real,
        'reparado_por_nombre', r.reparado_por_nombre,
        'fecha_reparacion', r.fecha_reparacion,
        'descripcion_reparacion', r.descripcion,
        'pendiente_por_nombre', up.nombre,
        'fecha_pendiente', f.fecha_pendiente,
        'motivo_pendiente', f.motivo_pendiente,
        'asignado_camion_id', f.asignado_camion_id,
        'asignado_camion_nombre', uc.nombre,
        'asignado_por_id', f.asignado_por_id,
        'asignado_por_nombre', uap.nombre,
        'fecha_asignacion', f.fecha_asignacion
      )
    ) as feat
    from public.fallas f
    left join (select id, nombre from public.usuarios union all select id, nombre from public.notificadores) ui on ui.id = coalesce(f.notificador_id, f.informado_por)
    left join public.usuarios ur2 on ur2.id = f.creado_por
    left join public.usuarios up on up.id = f.pendiente_por
    left join public.usuarios uc on uc.id = f.asignado_camion_id
    left join public.usuarios uap on uap.id = f.asignado_por_id
    join public.circuitos c on c.gid = f.ref_circuito_gid
    left join lateral (
      select r2.fecha_reparacion, r2.descripcion, ur.nombre as reparado_por_nombre
      from public.reparaciones r2
      left join public.usuarios ur on ur.id = r2.reparado_por
      where r2.falla_id = f.id
      order by r2.fecha_reparacion desc limit 1
    ) r on true
    where f.tipo = 'linea'
      and ((p_id is not null and f.id = p_id) or (p_id is null and (f.estado <> 'reparada' or r.fecha_reparacion > (now() - interval '16 hours'))))
  ) sub
$function$;
