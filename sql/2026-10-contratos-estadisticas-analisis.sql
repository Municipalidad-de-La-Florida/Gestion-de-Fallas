-- Contratos: Estadísticas, Análisis y mapa del período separados por contrato.
-- Agrega el parámetro opcional p_contratos (uuid[]; si no se envía, incluye todos los contratos) a:
--   estadisticas_fallas, analisis_fallas, analisis_puntos_afectados, fallas_geojson_periodo.
-- Sin ese parámetro todo responde igual que hoy. Requiere haber ejecutado antes el SQL de contratos (etapa 2).
-- Re-ejecutable.

drop function if exists public.estadisticas_fallas(timestamptz, timestamptz, text, boolean, uuid[]);
create function public.estadisticas_fallas(
  fecha_inicio timestamptz, fecha_fin timestamptz,
  p_medir text default 'informada', p_masivo boolean default null, p_asignadores uuid[] default null,
  p_contratos uuid[] default null)
returns jsonb
language plpgsql stable set search_path to 'public'
as $function$
declare
  resultado jsonb;
begin
  with c as (
    select f.*
    from public.fallas f
    left join public.fallas pa on pa.id = f.circuito_origen_id
    where (p_masivo is null or coalesce(pa.masivo, f.masivo, false) = p_masivo)
      and (p_contratos is null or coalesce(pa.contrato_id, f.contrato_id) = any(p_contratos))
      and (p_asignadores is null or coalesce(pa.asignado_por_id, f.asignado_por_id) = any(p_asignadores))
      and (
        case when p_medir = 'reparacion' then
          (select max(r.fecha_reparacion) from public.reparaciones r
            where r.falla_id in (f.id, f.circuito_origen_id)) >= fecha_inicio
          and (select max(r.fecha_reparacion) from public.reparaciones r
            where r.falla_id in (f.id, f.circuito_origen_id)) < fecha_fin
        else f.fecha_falla >= fecha_inicio and f.fecha_falla < fecha_fin end
      )
  )
  select jsonb_build_object(
    'total_fallas',             count(*) filter (where cascada = false),
    'fallas_punto_individual',  count(*) filter (where tipo = 'punto' and cascada = false),
    'fallas_circuito',          count(*) filter (where tipo = 'linea'),

    'puntos_afectados_total',       count(distinct ref_punto_gid) filter (where tipo = 'punto'),
    'puntos_afectados_individual',  count(distinct ref_punto_gid) filter (where tipo = 'punto' and cascada = false),
    'puntos_afectados_cascada',     count(distinct ref_punto_gid) filter (where tipo = 'punto' and cascada = true),

    'por_codigo', (
      select coalesce(jsonb_object_agg(tipo_falla, cnt), '{}'::jsonb)
      from (
        select tipo_falla, count(*) as cnt from c where cascada = false group by tipo_falla
      ) x
    ),

    'reparadas',          count(*) filter (where estado = 'reparada'  and cascada = false),
    'pendientes',         count(*) filter (where estado = 'pendiente' and cascada = false),
    'reiteradas',         count(*) filter (where estado = 'reiterada' and cascada = false),
    'reportadas_activas', count(*) filter (where estado = 'reportada' and cascada = false),
    'otros_estados',      count(*) filter (where cascada = false
                                            and estado not in ('reparada','pendiente','reiterada','reportada')),

    -- reparaciones hechas dentro del período (de las fallas que pasan los filtros)
    'reparadas_en_periodo', (
      select count(distinct r.falla_id)
      from public.reparaciones r
      join public.fallas f on f.id = r.falla_id
      left join public.fallas pa on pa.id = f.circuito_origen_id
      where f.cascada = false
        and (p_masivo is null or coalesce(f.masivo, false) = p_masivo)
        and (p_contratos is null or f.contrato_id = any(p_contratos))
        and (p_asignadores is null or f.asignado_por_id = any(p_asignadores))
        and r.fecha_reparacion >= fecha_inicio and r.fecha_reparacion < fecha_fin
    )
  )
  into resultado
  from c;

  return resultado;
end;
$function$;


drop function if exists public.analisis_fallas(date, date, text, boolean, uuid[], uuid);
create function public.analisis_fallas(
  p_inicio date, p_fin date,
  p_medir text default 'informada', p_masivo boolean default null,
  p_asignadores uuid[] default null, p_ito uuid default null,
  p_contratos uuid[] default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_ini timestamptz;
  v_fin timestamptz;
  v jsonb;
begin
  if not exists (select 1 from public.usuarios u
                 where u.id = auth.uid() and u.rol in ('admin','ito','ito2')) then
    return null;
  end if;
  if p_inicio is null or p_fin is null or p_inicio > p_fin then
    raise exception 'Rango de fechas inválido';
  end if;
  if p_fin - p_inicio > 400 then
    raise exception 'El rango no puede superar 400 días';
  end if;

  v_ini := p_inicio::timestamp at time zone 'America/Santiago';
  v_fin := (p_fin + 1)::timestamp at time zone 'America/Santiago';

  with base as materialized (
    select f.id, f.tipo, f.tipo_falla, f.estado, f.es_reiterada, f.fecha_falla, f.fecha_falla_real,
           f.informado_por, f.notificador_id, f.creado_por, f.ref_punto_gid, f.ref_circuito_gid,
           f.motivo_pendiente, f.fecha_pendiente, f.pendiente_por,
           r.fecha_reparacion, r.reparado_por,
           case when r.fecha_reparacion is null then null else greatest(0, extract(epoch from (r.fecha_reparacion - f.fecha_falla)) / 86400.0) end      as dias_insp,
           case when r.fecha_reparacion is null then null else greatest(0, extract(epoch from (r.fecha_reparacion - f.fecha_falla_real)) / 86400.0) end as dias_ing
    from public.fallas f
    left join lateral (
      select r2.fecha_reparacion, r2.reparado_por
      from public.reparaciones r2
      where r2.falla_id = f.id
      order by r2.fecha_reparacion desc
      limit 1
    ) r on true
    where f.cascada = false
      and (p_masivo is null or coalesce(f.masivo, false) = p_masivo)
      and (p_contratos is null or f.contrato_id = any(p_contratos))
      and (p_asignadores is null or f.asignado_por_id = any(p_asignadores))
      and (p_ito is null or coalesce(f.notificador_id, f.informado_por, f.creado_por) = p_ito)
      and (
        case when p_medir = 'reparacion'
          then r.fecha_reparacion >= v_ini and r.fecha_reparacion < v_fin
          else f.fecha_falla >= v_ini and f.fecha_falla < v_fin end
      )
  )
  select jsonb_build_object(
    'rango', jsonb_build_object('inicio', p_inicio, 'fin', p_fin),

    'resumen', (
      select jsonb_build_object(
        'fallas', count(*),
        'reparadas', count(fecha_reparacion),
        'abiertas', count(*) filter (where fecha_reparacion is null),
        'reiteradas', count(*) filter (where es_reiterada),
        'mediana_dias_insp', round((percentile_cont(0.5) within group (order by dias_insp))::numeric, 3),
        'mediana_dias_ing',  round((percentile_cont(0.5) within group (order by dias_ing))::numeric, 3),
        'promedio_dias_insp', round(avg(dias_insp)::numeric, 3),
        'promedio_dias_ing',  round(avg(dias_ing)::numeric, 3),
        'media_recortada_dias_ing', public.media_recortada(array_agg(dias_ing)), 'media_recortada_dias_insp', public.media_recortada(array_agg(dias_insp)),
        'antiguedad_mediana_abiertas',
          round((percentile_cont(0.5) within group (
            order by extract(epoch from (now() - fecha_falla)) / 86400.0
          ) filter (where fecha_reparacion is null))::numeric, 3)
      ) from base
    ),

    'por_codigo', coalesce((
      select jsonb_agg(x order by (x->>'fallas')::int desc, x->>'tipo_falla') from (
        select jsonb_build_object(
          'tipo_falla', tipo_falla, 'tipo', tipo,
          'fallas', count(*),
          'reparadas', count(fecha_reparacion),
          'reiteradas', count(*) filter (where es_reiterada),
          'mediana_insp', round((percentile_cont(0.5) within group (order by dias_insp))::numeric, 3),
          'max_insp', round(max(dias_insp)::numeric, 3),
          'mediana_ing', round((percentile_cont(0.5) within group (order by dias_ing))::numeric, 3),
          'max_ing', round(max(dias_ing)::numeric, 3), 'media_rec_insp', public.media_recortada(array_agg(dias_insp)), 'media_rec_ing', public.media_recortada(array_agg(dias_ing))) x
        from base group by tipo_falla, tipo
      ) t), '[]'::jsonb),

    'por_ito', coalesce((
      select jsonb_agg(x order by (x->>'fallas')::int desc, x->>'nombre') from (
        select jsonb_build_object(
          'nombre', coalesce(u.nombre, '—'),
          'fallas', count(*),
          'reparadas', count(b.fecha_reparacion),
          'reiteradas', count(*) filter (where b.es_reiterada),
          'mediana_insp', round((percentile_cont(0.5) within group (order by b.dias_insp))::numeric, 3),
          'mediana_ing', round((percentile_cont(0.5) within group (order by b.dias_ing))::numeric, 3), 'media_rec_insp', public.media_recortada(array_agg(b.dias_insp)), 'media_rec_ing', public.media_recortada(array_agg(b.dias_ing))) x
        from base b
        left join (select id, nombre from public.usuarios union all select id, nombre from public.notificadores) u on u.id = coalesce(b.notificador_id, b.informado_por, b.creado_por)
        group by u.id, u.nombre
      ) t), '[]'::jsonb),

    'por_camion', coalesce((
      select jsonb_agg(x order by (x->>'reparadas')::int desc, x->>'nombre') from (
        select jsonb_build_object(
          'nombre', coalesce(u.nombre, '—'),
          'reparadas', count(*),
          'mediana_insp', round((percentile_cont(0.5) within group (order by b.dias_insp))::numeric, 3),
          'max_insp', round(max(b.dias_insp)::numeric, 3),
          'mediana_ing', round((percentile_cont(0.5) within group (order by b.dias_ing))::numeric, 3),
          'max_ing', round(max(b.dias_ing)::numeric, 3), 'media_rec_insp', public.media_recortada(array_agg(b.dias_insp)), 'media_rec_ing', public.media_recortada(array_agg(b.dias_ing))) x
        from base b
        left join public.usuarios u on u.id = b.reparado_por
        where b.fecha_reparacion is not null
        group by u.id, u.nombre
      ) t), '[]'::jsonb),

    'criticos_puntos', coalesce((
      select jsonb_agg(x order by (x->>'reiteradas')::int desc, (x->>'fallas')::int desc) from (
        select jsonb_build_object(
          'gid', b.ref_punto_gid,
          'llave', p.llave, 'nro_mun', p.nro_mun,
          'direccion', nullif(concat_ws(' ', p.calle_1, p.direccion), ''),
          'lon', ST_X(p.geom), 'lat', ST_Y(p.geom),
          'fallas', count(*),
          'reiteradas', count(*) filter (where b.es_reiterada),
          'abiertas', count(*) filter (where b.fecha_reparacion is null),
          'codigos', string_agg(distinct b.tipo_falla, ', ')) x
        from base b
        left join public.puntos_luminarios p on p.gid = b.ref_punto_gid
        where b.tipo = 'punto'
        group by b.ref_punto_gid, p.llave, p.nro_mun, p.calle_1, p.direccion, p.geom
        having count(*) >= 2 or count(*) filter (where b.es_reiterada) >= 1
        order by count(*) filter (where b.es_reiterada) desc, count(*) desc
        limit 10
      ) t), '[]'::jsonb),

    'criticos_circuitos', coalesce((
      select jsonb_agg(x order by (x->>'reiteradas')::int desc, (x->>'fallas')::int desc) from (
        select jsonb_build_object(
          'gid', b.ref_circuito_gid,
          'circuito', c.id,
          'lon', ST_X(ST_Centroid(c.geom)), 'lat', ST_Y(ST_Centroid(c.geom)),
          'fallas', count(*),
          'reiteradas', count(*) filter (where b.es_reiterada),
          'abiertas', count(*) filter (where b.fecha_reparacion is null),
          'codigos', string_agg(distinct b.tipo_falla, ', ')) x
        from base b
        left join public.circuitos c on c.gid = b.ref_circuito_gid
        where b.tipo = 'linea'
        group by b.ref_circuito_gid, c.id, c.geom
        having count(*) >= 2 or count(*) filter (where b.es_reiterada) >= 1
        order by count(*) filter (where b.es_reiterada) desc, count(*) desc
        limit 10
      ) t), '[]'::jsonb),

    'pendientes', jsonb_build_object(
      'total_alguna_vez', (select count(*) from base where pendiente_por is not null),
      'actuales', (select count(*) from base where estado = 'pendiente'),
      'antiguedad_mediana_actuales', (
        select round((percentile_cont(0.5) within group (
          order by extract(epoch from (now() - fecha_pendiente)) / 86400.0))::numeric, 3)
        from base where estado = 'pendiente' and fecha_pendiente is not null),
      'motivos', coalesce((
        select jsonb_agg(x order by (x->>'veces')::int desc, x->>'motivo') from (
          select jsonb_build_object(
            'motivo', (array_agg(btrim(motivo_pendiente) order by fecha_pendiente desc))[1],
            'veces', count(*),
            'aun_pendientes', count(*) filter (where estado = 'pendiente'),
            'ya_reparadas', count(*) filter (where fecha_reparacion is not null)) x
          from base
          where pendiente_por is not null and nullif(btrim(motivo_pendiente), '') is not null
          group by lower(btrim(motivo_pendiente))
          order by count(*) desc
          limit 10
        ) t), '[]'::jsonb)
    ),

    'cobertura', jsonb_build_object(
      'por_dia', coalesce((
        select jsonb_agg(x order by x->>'fecha') from (
          select jsonb_build_object(
            'fecha', d.d::date,
            'dow', extract(dow from d.d)::int,
            'inspecciones', coalesce(i.n, 0),
            'fallas', coalesce(i.fallas, 0),
            'itos', i.itos, 'informadas', coalesce(inf.n, 0)) x
          from generate_series(p_inicio::timestamp, p_fin::timestamp, interval '1 day') d(d)
          left join (
            select i.fecha, count(distinct i.id) n,
                   count(f.id) filter (where f.cascada = false) fallas,
                   string_agg(distinct u.nombre, ', ') itos
            from public.inspecciones i
            join public.usuarios u on u.id = i.ito_id
            left join public.fallas f on f.inspeccion_id = i.id
            where i.fecha between p_inicio and p_fin
              and (p_ito is null or i.ito_id = p_ito)
            group by i.fecha
          ) i on i.fecha = d.d::date
          left join (select (b2.fecha_falla at time zone 'America/Santiago')::date dia, count(*) n from base b2 group by 1) inf on inf.dia = d.d::date
        ) t), '[]'::jsonb),
      'por_ito', coalesce((
        select jsonb_agg(x order by (x->>'inspecciones')::int desc, x->>'nombre') from (
          select jsonb_build_object(
            'nombre', u.nombre,
            'inspecciones', count(*),
            'sin_fallas', count(*) filter (where nf.n = 0),
            'fallas', coalesce(sum(nf.n), 0),
            'dias_distintos', count(distinct i.fecha)) x
          from public.inspecciones i
          join public.usuarios u on u.id = i.ito_id
          left join lateral (
            select count(*) n from public.fallas f where f.inspeccion_id = i.id and f.cascada = false
          ) nf on true
          where i.fecha between p_inicio and p_fin
            and (p_ito is null or i.ito_id = p_ito)
          group by u.id, u.nombre
        ) t), '[]'::jsonb)
    )
  ) into v;

  return v;
end;
$function$;


drop function if exists public.analisis_puntos_afectados(date, date, text, boolean, uuid[], uuid);
create function public.analisis_puntos_afectados(
  p_inicio date, p_fin date,
  p_medir text default 'informada', p_masivo boolean default null,
  p_asignadores uuid[] default null, p_ito uuid default null,
  p_contratos uuid[] default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_ini timestamptz;
  v_fin timestamptz;
  v_afectados integer;
  v_total integer;
begin
  if not exists (select 1 from public.usuarios u
                 where u.id = auth.uid() and u.rol in ('admin','ito','ito2')) then
    return null;
  end if;
  if p_inicio is null or p_fin is null or p_inicio > p_fin then
    raise exception 'Rango de fechas inválido';
  end if;
  if p_fin - p_inicio > 400 then
    raise exception 'El rango no puede superar 400 días';
  end if;

  v_ini := p_inicio::timestamp at time zone 'America/Santiago';
  v_fin := (p_fin + 1)::timestamp at time zone 'America/Santiago';

  with cohorte as (
    select f.id, f.tipo, f.ref_punto_gid
    from public.fallas f
    where f.cascada = false
      and (p_masivo is null or coalesce(f.masivo, false) = p_masivo)
      and (p_contratos is null or f.contrato_id = any(p_contratos))
      and (p_asignadores is null or f.asignado_por_id = any(p_asignadores))
      and (p_ito is null or coalesce(f.notificador_id, f.informado_por, f.creado_por) = p_ito)
      and (
        case when p_medir = 'reparacion' then
          (select max(r.fecha_reparacion) from public.reparaciones r where r.falla_id = f.id) >= v_ini
          and (select max(r.fecha_reparacion) from public.reparaciones r where r.falla_id = f.id) < v_fin
        else f.fecha_falla >= v_ini and f.fecha_falla < v_fin end
      )
  )
  select count(*)::integer into v_afectados from (
    select h.ref_punto_gid as gid
    from cohorte h
    where h.tipo = 'punto' and h.ref_punto_gid is not null
    union
    select c.ref_punto_gid
    from cohorte h
    join public.fallas c on c.circuito_origen_id = h.id
    where h.tipo = 'linea' and c.ref_punto_gid is not null
  ) s;

  select count(*)::integer into v_total from public.puntos_luminarios where activo;

  return jsonb_build_object('puntos_afectados', v_afectados, 'total_puntos', v_total);
end;
$function$;


drop function if exists public.fallas_geojson_periodo(timestamptz, timestamptz, text, boolean, uuid[]);
create function public.fallas_geojson_periodo(
  fecha_inicio timestamptz, fecha_fin timestamptz,
  p_medir text default 'informada', p_masivo boolean default null, p_asignadores uuid[] default null,
  p_contratos uuid[] default null)
returns jsonb
language sql stable set search_path to 'public'
as $function$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(feat), '[]'::jsonb)
  )
  from (
    select jsonb_build_object(
      'type','Feature',
      'geometry', ST_AsGeoJSON(p.geom)::jsonb,
      'properties', jsonb_build_object(
        'id', f.id, 'tipo', f.tipo, 'tipo_falla', f.tipo_falla,
        'estado', f.estado, 'cascada', f.cascada, 'fecha_creacion', f.fecha_falla
      )
    ) as feat
    from public.fallas f
    left join public.fallas pa on pa.id = f.circuito_origen_id
    join public.puntos_luminarios p on p.gid = f.ref_punto_gid
    where f.tipo = 'punto'
      and (p_masivo is null or coalesce(pa.masivo, f.masivo, false) = p_masivo)
        and (p_contratos is null or coalesce(pa.contrato_id, f.contrato_id) = any(p_contratos))
      and (p_asignadores is null or coalesce(pa.asignado_por_id, f.asignado_por_id) = any(p_asignadores))
      and (
        case when p_medir = 'reparacion' then
          (select max(r.fecha_reparacion) from public.reparaciones r where r.falla_id in (f.id, f.circuito_origen_id)) >= fecha_inicio
          and (select max(r.fecha_reparacion) from public.reparaciones r where r.falla_id in (f.id, f.circuito_origen_id)) < fecha_fin
        else f.fecha_falla >= fecha_inicio and f.fecha_falla < fecha_fin end
      )

    union all

    select jsonb_build_object(
      'type','Feature',
      'geometry', ST_AsGeoJSON(c.geom)::jsonb,
      'properties', jsonb_build_object(
        'id', f.id, 'tipo', f.tipo, 'tipo_falla', f.tipo_falla,
        'estado', f.estado, 'cascada', f.cascada, 'fecha_creacion', f.fecha_falla
      )
    ) as feat
    from public.fallas f
    join public.circuitos c on c.gid = f.ref_circuito_gid
    where f.tipo = 'linea'
      and (p_masivo is null or coalesce(f.masivo, false) = p_masivo)
      and (p_contratos is null or f.contrato_id = any(p_contratos))
      and (p_asignadores is null or f.asignado_por_id = any(p_asignadores))
      and (
        case when p_medir = 'reparacion' then
          (select max(r.fecha_reparacion) from public.reparaciones r where r.falla_id = f.id) >= fecha_inicio
          and (select max(r.fecha_reparacion) from public.reparaciones r where r.falla_id = f.id) < fecha_fin
        else f.fecha_falla >= fecha_inicio and f.fecha_falla < fecha_fin end
      )
  ) sub
$function$;

