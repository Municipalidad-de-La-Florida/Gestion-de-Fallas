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
