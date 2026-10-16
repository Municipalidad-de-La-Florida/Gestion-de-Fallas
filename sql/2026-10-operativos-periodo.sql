-- Operativos en las estadísticas y el análisis: devuelve, para un rango de fechas, cada operativo registrado
-- (tabla operativos_inspeccion) con sus cifras, y el promedio de los días de inspección normales para comparar.
-- No cambia ninguna función existente: la web la consulta aparte. Se puede ejecutar más de una vez.
-- Un operativo se registra desde la web (Operativo, en el panel de inspecciones) o con activar_operativo(fecha, motivo);
-- el motivo hace de nombre (ej. «Operativo Santa Julia»).

create or replace function public.operativos_periodo(p_inicio date, p_fin date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol in ('admin','ito','ito2')) then
    return null;
  end if;
  with dias as (
    select i.fecha,
           count(distinct i.id) inspecciones,
           count(distinct i.ito_id) itos,
           count(distinct i.ito_id) filter (where u.rol = 'ito') itos_ito,
           string_agg(distinct u.nombre, ', ' order by u.nombre) nombres
    from public.inspecciones i
    join public.usuarios u on u.id = i.ito_id
    where i.fecha between p_inicio and p_fin
    group by i.fecha
  ),
  fd as (
    select i.fecha,
           count(*) fallas,
           count(*) filter (where f.estado = 'reparada') reparadas,
           count(*) filter (where f.estado = 'pendiente') pendientes,
           count(*) filter (where f.es_reiterada) reiteradas,
           count(*) filter (where f.estado <> 'reparada') abiertas
    from public.inspecciones i
    join public.fallas f on f.inspeccion_id = i.id and f.cascada = false
    where i.fecha between p_inicio and p_fin
    group by i.fecha
  ),
  normales as (
    select d.fecha, d.inspecciones, d.itos, coalesce(fd.fallas, 0) fallas
    from dias d left join fd on fd.fecha = d.fecha
    where not exists (select 1 from public.operativos_inspeccion o where o.fecha = d.fecha)
  )
  select jsonb_build_object(
    'operativos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fecha', o.fecha, 'nombre', coalesce(o.motivo, 'Operativo'),
        'inspecciones', coalesce(d.inspecciones, 0), 'itos', coalesce(d.itos, 0), 'itos_ito', coalesce(d.itos_ito, 0), 'inspectores', d.nombres,
        'fallas', coalesce(fd.fallas, 0), 'reparadas', coalesce(fd.reparadas, 0), 'pendientes', coalesce(fd.pendientes, 0),
        'reiteradas', coalesce(fd.reiteradas, 0), 'abiertas', coalesce(fd.abiertas, 0)
      ) order by o.fecha)
      from public.operativos_inspeccion o
      left join dias d on d.fecha = o.fecha
      left join fd on fd.fecha = o.fecha
      where o.fecha between p_inicio and p_fin), '[]'::jsonb),
    'itos_total', (select count(*) from public.usuarios where rol = 'ito'),
    'normal', jsonb_build_object(
      'dias', (select count(*) from normales),
      'inspecciones_prom', (select round(avg(inspecciones)::numeric, 1) from normales),
      'itos_prom', (select round(avg(itos)::numeric, 1) from normales),
      'fallas_prom', (select round(avg(fallas)::numeric, 1) from normales))
  ) into v;
  return v;
end $$;
revoke all on function public.operativos_periodo(date, date) from public;
grant execute on function public.operativos_periodo(date, date) to authenticated;
