-- Cuadrillas: requerimientos asignados / ejecutados por cada cuadrilla (ya aplicado en Supabase)
CREATE OR REPLACE FUNCTION public.cuadrilla_requerimientos(p_desde timestamptz, p_hasta timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Sin sesión'; end if;
  if not public.tiene_permiso('rendimiento_cuadrillas') then raise exception 'No tienes permiso para ver el rendimiento de cuadrillas'; end if;
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then raise exception 'Rango de fechas inválido'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'req_id', x.id, 'codigo', public._req_codigo(x.numero), 'tipo_label', public._req_tipo_label(x.tipo),
      'ubicacion', public._req_ubic((select q from public.requerimientos q where q.id = x.id)), 'urgente', x.urgente, 'estado', x.estado, 'camion_id', x.camion_id,
      'asignado_en', x.asignado_en, 'ejecutado_en', x.ejecutado_en) order by coalesce(x.ejecutado_en, x.asignado_en))
    from (
      select r.*, r.asignado_a as camion_id,
             (select max(h.fecha) from public.requerimientos_historial h where h.req_id = r.id and h.accion in ('asignar', 'reasignar') and h.destino = r.asignado_a) as asignado_en,
             null::timestamptz as ejecutado_en
        from public.requerimientos r
       where r.estado = 'asignado' and r.asignado_a in (select public.camiones_en_mi_alcance()) and public._req_ve(r, u)
      union all
      select r.*, h.usuario_id as camion_id, null::timestamptz, h.fecha
        from public.requerimientos_historial h join public.requerimientos r on r.id = h.req_id
       where h.accion = 'ejecutar' and h.fecha >= p_desde and h.fecha < p_hasta
         and h.usuario_id in (select public.camiones_en_mi_alcance()) and public._req_ve(r, u)
    ) x), '[]'::jsonb);
end $function$;
