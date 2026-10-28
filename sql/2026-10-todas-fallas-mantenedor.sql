-- "Todas las fallas": agrega el mantenedor de cada falla (para el filtro y la columna Contrato · Mantenedor) y lo incluye en la búsqueda.
-- Se puede ejecutar más de una vez.
drop function if exists public.resumen_todas_fallas(integer, integer, text);
create function public.resumen_todas_fallas(limite integer default 500, desplazamiento integer default 0, busqueda text default null)
returns table(id uuid, ot text, orden_externa text, tipo text, tipo_falla text, estado text, fecha_creacion timestamptz, creado_en timestamptz, creado_por uuid,
  nombre_creador text, nombre_real_creador text, n_cliente text, llave integer, puntos_afectados integer, cardinalidad text, descripcion_otro text,
  reparado_por_nombre text, fecha_reparacion timestamptz, descripcion_reparacion text, pendiente_por_nombre text, fecha_pendiente timestamptz, motivo_pendiente text,
  masivo boolean, asignado_por_id uuid, asignado_por_nombre text, asignado_camion_nombre text, fecha_asignacion timestamptz, contrato_id uuid, contrato_nombre text,
  mantenedor_id uuid, mantenedor_nombre text)
language sql stable set search_path to 'public' as $function$
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
    f.contrato_id, ct.nombre as contrato_nombre,
    f.mantenedor_id, mt.nombre as mantenedor_nombre
  from public.fallas f
  left join (select id, nombre from public.usuarios union all select id, nombre from public.notificadores) ui on ui.id = coalesce(f.notificador_id, f.informado_por)
  left join public.usuarios ur2 on ur2.id = f.creado_por
  left join public.usuarios up on up.id = f.pendiente_por
  left join public.usuarios ua on ua.id = f.asignado_por_id
  left join public.usuarios ucam on ucam.id = f.asignado_camion_id
  left join public.contratos ct on ct.id = f.contrato_id
  left join public.mantenedores mt on mt.id = f.mantenedor_id
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
                ua.nombre, ucam.nombre, ct.nombre, mt.nombre,
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
revoke all on function public.resumen_todas_fallas(integer, integer, text) from public, anon;
grant execute on function public.resumen_todas_fallas(integer, integer, text) to authenticated;
