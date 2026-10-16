-- Detalle de un operativo: las fallas ingresadas en las inspecciones de esa fecha (solo del operativo),
-- con su ubicación, estado, inspector y fecha de reparación. La web arma con esto el mapa y las estadísticas.
-- No cambia ninguna función existente. Se puede ejecutar más de una vez.

create or replace function public.operativo_detalle(p_fecha date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol in ('admin','ito','ito2')) then
    return null;
  end if;
  select jsonb_build_object(
    'fecha', p_fecha,
    'nombre', (select coalesce(o.motivo, 'Operativo') from public.operativos_inspeccion o where o.fecha = p_fecha),
    'inspectores', (select string_agg(distinct u.nombre, ', ' order by u.nombre)
                    from public.inspecciones i join public.usuarios u on u.id = i.ito_id where i.fecha = p_fecha),
    'inspecciones', (select count(*) from public.inspecciones i where i.fecha = p_fecha),
    'fallas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'ot', f.ot, 'tipo', f.tipo, 'tipo_falla', f.tipo_falla, 'estado', f.estado,
        'es_reiterada', f.es_reiterada,
        'fecha_falla', f.fecha_falla, 'fecha_falla_real', f.fecha_falla_real, 'fecha_pendiente', f.fecha_pendiente,
        'inspector', u.nombre,
        'fecha_reparacion', (select min(r.fecha_reparacion) from public.reparaciones r where r.falla_id = f.id),
        'puntos', case when f.tipo = 'linea'
                    then (select count(*) from public.fallas h where h.circuito_origen_id = f.id)
                    else 1 end,
        'direccion', coalesce(nullif(concat_ws(' ', p.calle_1, p.direccion), ''), case when f.tipo = 'linea' then 'Circuito ' || f.ref_circuito_gid end),
        'geom', coalesce(ST_AsGeoJSON(p.geom)::jsonb, ST_AsGeoJSON(c.geom)::jsonb)
      ) order by f.ot)
      from public.inspecciones i
      join public.fallas f on f.inspeccion_id = i.id and f.cascada = false
      join public.usuarios u on u.id = i.ito_id
      left join public.puntos_luminarios p on f.tipo = 'punto' and p.gid = f.ref_punto_gid
      left join public.circuitos c on f.tipo = 'linea' and c.gid = f.ref_circuito_gid
      where i.fecha = p_fecha), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.operativo_detalle(date) from public;
grant execute on function public.operativo_detalle(date) to authenticated;
