-- Filtro 3: "Todas las fallas" muestra quién asigna + exportación por período/asignadores.
-- Ejecutar ANTES de publicar el cambio del index.html (es compatible hacia atrás: solo agrega columnas
-- y parámetros con valor por defecto).

drop function if exists public.resumen_todas_fallas(integer, integer, text);
create function public.resumen_todas_fallas(limite integer default 500, desplazamiento integer default 0, busqueda text default null)
returns table(id uuid, ot text, orden_externa text, tipo text, tipo_falla text, estado text, fecha_creacion timestamptz, creado_en timestamptz, creado_por uuid, nombre_creador text, nombre_real_creador text, n_cliente text, llave integer, puntos_afectados integer, cardinalidad text, descripcion_otro text, reparado_por_nombre text, fecha_reparacion timestamptz, descripcion_reparacion text, pendiente_por_nombre text, fecha_pendiente timestamptz, motivo_pendiente text, masivo boolean,
  asignado_por_id uuid, asignado_por_nombre text, asignado_camion_nombre text, fecha_asignacion timestamptz)
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
    f.asignado_por_id, ua.nombre as asignado_por_nombre, ucam.nombre as asignado_camion_nombre, f.fecha_asignacion
  from public.fallas f
  left join (select id, nombre from public.usuarios union all select id, nombre from public.notificadores) ui on ui.id = coalesce(f.notificador_id, f.informado_por)
  left join public.usuarios ur2 on ur2.id = f.creado_por
  left join public.usuarios up on up.id = f.pendiente_por
  left join public.usuarios ua on ua.id = f.asignado_por_id
  left join public.usuarios ucam on ucam.id = f.asignado_camion_id
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
                ua.nombre, ucam.nombre,
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

-- Exportación: fechas opcionales (null = desde siempre), criterio de fecha y lista de asignadores.
drop function if exists public.resumen_fallas_exportar(timestamptz, timestamptz);
create function public.resumen_fallas_exportar(fecha_inicio timestamptz default null, fecha_fin timestamptz default null, tipo_fecha text default 'informada', asignadores uuid[] default null)
returns table(id uuid, ot text, orden_externa text, tipo text, tipo_falla text, estado text, fecha_creacion timestamptz, nombre_creador text, n_cliente text, llave integer, nro_mun integer, simb_poste text, puntos_afectados integer, reparado_por_nombre text, fecha_reparacion timestamptz, descripcion_reparacion text, pendiente_por_nombre text, fecha_pendiente timestamptz, motivo_pendiente text, fecha_creacion_real timestamptz, nombre_real_creador text,
  masivo boolean, asignado_por_id uuid, asignado_por_nombre text, asignado_camion_nombre text, fecha_asignacion timestamptz)
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
    f.masivo, f.asignado_por_id, ua.nombre as asignado_por_nombre, ucam.nombre as asignado_camion_nombre, f.fecha_asignacion
  from public.fallas f
  left join (select id, nombre from public.usuarios union all select id, nombre from public.notificadores) ui on ui.id = coalesce(f.notificador_id, f.informado_por)
  left join public.usuarios ur2 on ur2.id = f.creado_por
  left join public.usuarios up on up.id = f.pendiente_por
  left join public.usuarios ua on ua.id = f.asignado_por_id
  left join public.usuarios ucam on ucam.id = f.asignado_camion_id
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
