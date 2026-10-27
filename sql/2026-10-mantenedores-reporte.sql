-- Reporte de fallas con contrato y mantenedor (después de 2026-10-mantenedores-etapa1.sql).
-- Amplía crear_falla_punto (la usa la app móvil) con el uso y el contrato/mantenedor elegidos en el selector.
-- Se puede repetir. No activa la derivación automática: eso se hace en 2026-10-mantenedores-activar-derivacion.sql.
begin;

drop function if exists public.crear_falla_punto(integer, text, text, text, text, timestamptz, uuid, uuid, boolean);

create or replace function public.crear_falla_punto(
  p_punto_gid integer, p_tipo_falla text, p_cardinalidad text default null, p_descripcion text default null,
  p_orden_externa text default null, p_fecha_falla timestamptz default null, p_notificador_id uuid default null,
  p_inspeccion_id uuid default null, p_masivo boolean default false,
  p_uso_grupo text default null, p_contrato_id uuid default null, p_mantenedor_id uuid default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_desc   text := nullif(btrim(p_descripcion), '');
  v_oe     text := nullif(btrim(p_orden_externa), '');
  v_fecha  timestamptz := coalesce(p_fecha_falla, now());
  v_uso    text := nullif(upper(btrim(p_uso_grupo)), '');
  v_id     uuid;
  v_ot     text;
  v_estado text;
begin
  if v_uid is null then raise exception 'Sin sesión'; end if;

  if not exists (select 1 from public.puntos_luminarios where gid = p_punto_gid and activo) then
    raise exception 'El punto lumínico no existe o está inactivo';
  end if;
  if p_tipo_falla is null or not (p_tipo_falla = any (array['F01','F02','F03','F04','F05','F20','F22','F23','F29','F32','F33','F35','F38','F42','F43','OTRO'])) then
    raise exception 'Código de falla no válido para un punto';
  end if;
  if p_tipo_falla = 'OTRO' and v_desc is null then
    raise exception 'Describe la falla (obligatorio si es OTRO)';
  end if;
  if p_cardinalidad is not null and not (p_cardinalidad = any (array['N','S','P','O'])) then
    raise exception 'Cardinalidad no válida';
  end if;
  if v_oe is not null and v_oe !~ '^[SE]-[^[:space:]]{1,38}$' then
    raise exception 'La orden externa debe ser empresa + número (S-123 o E-123)';
  end if;
  if v_uso is not null and v_uso not in ('VIAL', 'PEATONAL', 'OTRO') then
    raise exception 'Tipo de uso no válido';
  end if;

  insert into public.fallas
    (tipo, ref_punto_gid, tipo_falla, cardinalidad, descripcion_otro, cascada,
     creado_por, orden_externa, fecha_falla, notificador_id, inspeccion_id, masivo,
     uso_grupo, contrato_id, mantenedor_id)
  values
    ('punto', p_punto_gid, p_tipo_falla, p_cardinalidad, v_desc, false,
     v_uid, v_oe, v_fecha, p_notificador_id, p_inspeccion_id, coalesce(p_masivo, false),
     v_uso, p_contrato_id, p_mantenedor_id)
  returning id, ot, estado into v_id, v_ot, v_estado;

  if p_masivo then
    insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre, creado_en)
    values (v_id, 'masivo', 'Masivo', v_uid, (select nombre from public.usuarios where id = v_uid), now() - interval '1 second');
  end if;
  if v_desc is not null then
    insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
    values (v_id, 'reporte', v_desc, v_uid, (select nombre from public.usuarios where id = v_uid));
  end if;

  return jsonb_build_object('id', v_id, 'ot', v_ot, 'estado', v_estado);
end;
$$;
grant execute on function public.crear_falla_punto(integer, text, text, text, text, timestamptz, uuid, uuid, boolean, text, uuid, uuid) to authenticated;

-- Estado de mantención de un circuito (para avisar "Sin Mantenimiento" a quien reporta)
create or replace function public.estado_mantencion_circuito(p_gid integer)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(mant_estado, 'pendiente') from public.circuitos where gid = p_gid;
$$;
revoke all on function public.estado_mantencion_circuito(integer) from public, anon;
grant execute on function public.estado_mantencion_circuito(integer) to authenticated;

commit;
