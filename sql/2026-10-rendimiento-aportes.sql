-- Rendimiento de cuadrillas: agrega los APORTES (requiere haber ejecutado sql/2026-10-aportes.sql).
-- Reemplaza rendimiento_cuadrillas_v2 sumando a cada fila 'es_aporte' y 'maestro' (nombre). Lo demás queda igual.
-- Los aportes ya cuentan como asignadas/reparadas de la cuadrilla; la app y la web los muestran además como contador y por maestro.
-- Se puede ejecutar más de una vez.

create or replace function public.rendimiento_cuadrillas_v2(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rol text := coalesce(public.mi_rol(), '');
begin
  if not coalesce((select ver_cuadrillas from public.usuarios where id = auth.uid()), false) then
    raise exception 'No tienes permiso para ver el rendimiento de cuadrillas';
  end if;
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then raise exception 'Rango de fechas inválido'; end if;

  return jsonb_build_object(
    'contratos', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre) order by c.nombre)
      from public.contratos c where c.activo and public.contrato_visible(c.id)), '[]'::jsonb),

    -- Cuadrillas: un contratista solo ve las que comparten alguno de sus contratos
    'cuadrillas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', u.nombre,
        'contratos', coalesce((select jsonb_agg(uc.contrato_id) from public.usuario_contratos uc
                               where uc.usuario_id = u.id and public.contrato_visible(uc.contrato_id)), '[]'::jsonb)
      ) order by u.nombre)
      from public.usuarios u
      where u.rol = 'camion' and u.nombre not ilike 'zzz%'
        and (v_rol not in ('contratista', 'contratista2', 'contratista3')
             or exists (select 1 from public.usuario_contratos uc where uc.usuario_id = u.id and public.contrato_visible(uc.contrato_id)))
    ), '[]'::jsonb),

    -- Fallas activas por contrato: abiertas al inicio del turno (ingresadas antes y sin reparar antes) + ingresadas durante el turno
    'activas', coalesce((
      select jsonb_agg(jsonb_build_object('contrato_id', c.id,
        'inicio', (select count(*) from public.fallas f
                   where f.contrato_id = c.id and f.cascada is not true
                     and coalesce(f.fecha_falla_real, f.fecha_falla) < p_desde
                     and not exists (select 1 from public.reparaciones r where r.falla_id = f.id and r.fecha_reparacion < p_desde)),
        'ingresadas', (select count(*) from public.fallas f
                       where f.contrato_id = c.id and f.cascada is not true
                         and coalesce(f.fecha_falla_real, f.fecha_falla) >= p_desde
                         and coalesce(f.fecha_falla_real, f.fecha_falla) < p_hasta)))
      from public.contratos c where c.activo and public.contrato_visible(c.id)), '[]'::jsonb),

    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'camion_id', h.camion_id,
        'contrato_id', f.contrato_id,
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
        'motivo_pendiente', f.motivo_pendiente,
        'es_aporte', coalesce(f.es_aporte, false),
        'maestro', mt.nombre
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
      left join public.maestros mt on mt.id = f.maestro_id
      where h.asignado_en < p_hasta
        and not (h.quitado_en is not null and h.quitado_en < p_hasta
                 and (r.fecha_reparacion is null or r.fecha_reparacion > h.quitado_en))
        and (r.fecha_reparacion is null or r.fecha_reparacion >= p_desde)
        and (v_rol not in ('contratista', 'contratista2', 'contratista3') or public.contrato_visible(f.contrato_id))
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.rendimiento_cuadrillas_v2(timestamptz, timestamptz) from public;
grant execute on function public.rendimiento_cuadrillas_v2(timestamptz, timestamptz) to authenticated;

