-- Fiscalización: solo para administrador e ITO (ito / ito2). Se puede ejecutar más de una vez.
-- Quita la casilla a cualquier otro rol (p. ej. observador) y refuerza la restricción en la función.
update public.usuarios set ver_fiscalizacion = false where rol not in ('admin','ito','ito2') and ver_fiscalizacion;

create or replace function public.fiscalizacion_fallas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.mi_rol() not in ('admin','ito','ito2')
     or not coalesce((select ver_fiscalizacion from public.usuarios where id = auth.uid()), false) then
    raise exception 'No tienes permiso para ver la fiscalización de trabajos';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'falla_id', f.id,
      'ot', f.ot,
      'tipo', f.tipo,
      'tipo_falla', f.tipo_falla,
      'direccion', coalesce(nullif(concat_ws(' ', p.calle_1, p.direccion), ''), case when f.tipo = 'linea' then 'Circuito ' || f.ref_circuito_gid end),
      'puntos_afectados', case when f.tipo = 'linea' then (select count(*)::integer from public.fallas fc where fc.circuito_origen_id = f.id) else 1 end,
      'geom', coalesce(ST_AsGeoJSON(p.geom)::jsonb, ST_AsGeoJSON(c.geom)::jsonb),
      'estado', f.estado,
      'informada_en', coalesce(f.fecha_falla_real, f.fecha_falla),
      'es_reiterada', coalesce(f.es_reiterada, false),
      'masivo', coalesce(f.masivo, false),
      'contrato', ct.nombre,
      'camion_id', f.asignado_camion_id,
      'camion', uc.nombre,
      'asignada_en', f.fecha_asignacion,
      'pendiente_en', f.fecha_pendiente,
      'motivo_pendiente', f.motivo_pendiente,
      'pendiente_por', up.nombre
    ) order by coalesce(f.fecha_falla_real, f.fecha_falla))
    from public.fallas f
    left join public.puntos_luminarios p on f.tipo = 'punto' and p.gid = f.ref_punto_gid
    left join public.circuitos c on f.tipo = 'linea' and c.gid = f.ref_circuito_gid
    left join public.contratos ct on ct.id = f.contrato_id
    left join public.usuarios uc on uc.id = f.asignado_camion_id
    left join public.usuarios up on up.id = f.pendiente_por
    where f.cascada is not true and f.estado <> 'reparada'
  ), '[]'::jsonb);
end $$;
revoke all on function public.fiscalizacion_fallas() from public;
grant execute on function public.fiscalizacion_fallas() to authenticated;

-- Cuadrillas: ahora solo con la casilla (sin excepción para el administrador)

create or replace function public.rendimiento_cuadrillas(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce((select ver_cuadrillas from public.usuarios where id = auth.uid()), false) then
    raise exception 'No tienes permiso para ver el rendimiento de cuadrillas';
  end if;
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then raise exception 'Rango de fechas inválido'; end if;

  return jsonb_build_object(
    'cuadrillas', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.nombre)
      from public.usuarios u where u.rol = 'camion' and u.nombre not ilike 'zzz%'), '[]'::jsonb),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'camion_id', h.camion_id,
        'falla_id', f.id,
        'ot', f.ot,
        'tipo', f.tipo,
        'tipo_falla', f.tipo_falla,
        'direccion', coalesce(nullif(concat_ws(' ', p.calle_1, p.direccion), ''), case when f.tipo = 'linea' then 'Circuito ' || f.ref_circuito_gid end),
        'geom', coalesce(ST_AsGeoJSON(p.geom)::jsonb, ST_AsGeoJSON(c.geom)::jsonb),
        'asignado_en', h.asignado_en,
        'quitado_en', h.quitado_en,
        'reparada_en', r.fecha_reparacion,
        'reparado_por', r.reparado_por,
        'reparado_por_rol', ur.rol,
        'pendiente_por_rol', up.rol,
        'estado', f.estado,
        'fecha_pendiente', f.fecha_pendiente,
        'motivo_pendiente', f.motivo_pendiente
      ) order by h.asignado_en)
      from public.asignaciones_historial h
      join public.usuarios u on u.id = h.camion_id and u.rol = 'camion' and u.nombre not ilike 'zzz%'
      join public.fallas f on f.id = h.falla_id and f.cascada is not true
      left join public.puntos_luminarios p on f.tipo = 'punto' and p.gid = f.ref_punto_gid
      left join public.circuitos c on f.tipo = 'linea' and c.gid = f.ref_circuito_gid
      left join lateral (
        select r2.fecha_reparacion, r2.reparado_por from public.reparaciones r2
        where r2.falla_id = f.id and r2.fecha_reparacion >= h.asignado_en
        order by r2.fecha_reparacion asc limit 1
      ) r on true
      left join public.usuarios ur on ur.id = r.reparado_por
      left join public.usuarios up on up.id = f.pendiente_por
      where h.asignado_en < p_hasta
        -- si la falla se reasignó a otra cuadrilla sin que esta la reparara, no cuenta para ella
        and not (h.quitado_en is not null and h.quitado_en < p_hasta
                 and (r.fecha_reparacion is null or r.fecha_reparacion > h.quitado_en))
        -- si ya estaba reparada antes de empezar el turno, tampoco
        and (r.fecha_reparacion is null or r.fecha_reparacion >= p_desde)
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.rendimiento_cuadrillas(timestamptz, timestamptz) from public;
grant execute on function public.rendimiento_cuadrillas(timestamptz, timestamptz) to authenticated;
