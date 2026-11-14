-- Historial de la falla: la respuesta del camión ya no se pierde cuando el administrador edita o quita la reparación.
--  * Editar: el comentario del camión se conserva y la corrección queda como comentario nuevo (tipo 'revision').
--  * Quitar: el comentario y las fotos del camión se conservan (tipo 'reparacion_anulada' / fotos con anulada_en).
-- Ejecutar completo en el SQL Editor (elegir "Run without RLS" si pregunta). Idempotente.

-- 1) Nuevos tipos de comentario
alter table public.fallas_comentarios drop constraint if exists fallas_comentarios_tipo_check;
alter table public.fallas_comentarios add constraint fallas_comentarios_tipo_check
  check (tipo = any (array['reporte','asignacion','pendiente','reparacion','masivo','comentario','aporte','cierre','revision','reparacion_anulada']));

-- 2) Las fotos de una reparación anulada se conservan, marcadas
alter table public.fallas_fotos add column if not exists anulada_en timestamptz;

-- 3) Editar la reparación: conserva el texto del camión y agrega la revisión
create or replace function public.editar_reparacion(p_falla_id uuid, p_cambios jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.reparaciones; f public.fallas%rowtype;
  v_desc text; v_tipo text; v_otro text; v_oe text; v_codigos text[]; v_nombre text; v_nota text; v_rev text;
begin
  r := public._reparacion_autorizada(p_falla_id);
  select * into f from public.fallas where id = p_falla_id for update;
  select nombre into v_nombre from public.usuarios where id = auth.uid();
  v_nota := nullif(btrim(p_cambios->>'revision'), '');

  perform set_config('app.editando_falla', '1', true);

  if p_cambios ? 'descripcion' then
    v_desc := nullif(btrim(p_cambios->>'descripcion'), '');
    if v_desc is null then raise exception 'La descripción de la reparación no puede estar vacía'; end if;
    update public.reparaciones set descripcion = v_desc where id = r.id;
    -- el comentario del camión NO se toca; si faltara, se recrea con el texto original
    if not exists (select 1 from public.fallas_comentarios where falla_id = p_falla_id and tipo = 'reparacion') then
      insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre, creado_en)
        values (p_falla_id, 'reparacion', r.descripcion, r.reparado_por,
                (select nombre from public.usuarios where id = r.reparado_por), r.creado_en);
    end if;
    v_rev := 'Trabajo corregido: ' || v_desc;
  end if;
  if v_nota is not null then v_rev := v_nota || coalesce(E'\n\n' || v_rev, ''); end if;
  if v_rev is not null then
    insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
      values (p_falla_id, 'revision', v_rev, auth.uid(), v_nombre);
  end if;

  if p_cambios ? 'tipo_falla' or p_cambios ? 'descripcion_otro' or p_cambios ? 'orden_externa' then
    v_tipo := f.tipo_falla; v_otro := f.descripcion_otro; v_oe := f.orden_externa;
    if p_cambios ? 'tipo_falla' then v_tipo := nullif(btrim(p_cambios->>'tipo_falla'), ''); end if;
    if p_cambios ? 'descripcion_otro' then v_otro := nullif(btrim(p_cambios->>'descripcion_otro'), ''); end if;
    if p_cambios ? 'orden_externa' then v_oe := nullif(btrim(p_cambios->>'orden_externa'), ''); end if;
    v_codigos := case when f.tipo = 'linea'
      then array['F02','F03','F30','F31','F45','F46','OTRO']
      else array['F01','F02','F03','F04','F05','F22','F23','F29','F32','F33','F35','F38','F43','OTRO'] end;
    if v_tipo is null or not (v_tipo = any(v_codigos)) then raise exception 'Código de falla no válido'; end if;
    if v_tipo = 'OTRO' and v_otro is null then raise exception 'Describe la falla (obligatorio si es OTRO)'; end if;
    if v_oe is not null and v_oe !~ '^[SE]-[^[:space:]]{1,38}$' then
      raise exception 'La orden externa debe ser empresa + número (S-123 o E-123)';
    end if;
    update public.fallas set tipo_falla = v_tipo, descripcion_otro = v_otro, orden_externa = v_oe where id = p_falla_id;
    if f.tipo = 'linea' then
      update public.fallas set tipo_falla = v_tipo, descripcion_otro = v_otro, orden_externa = v_oe where circuito_origen_id = p_falla_id;
    end if;
    if v_otro is null then
      delete from public.fallas_comentarios where falla_id = p_falla_id and tipo = 'reporte';
    elsif exists (select 1 from public.fallas_comentarios where falla_id = p_falla_id and tipo = 'reporte') then
      update public.fallas_comentarios set comentario = v_otro where falla_id = p_falla_id and tipo = 'reporte';
    end if;
  end if;

  perform set_config('app.editando_falla', '', true);
end $$;

-- 4) Quitar la reparación: conserva la respuesta y las fotos del camión
drop function if exists public.anular_reparacion(uuid, text);
create or replace function public.anular_reparacion(p_falla_id uuid, p_motivo_pendiente text default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r public.reparaciones; f public.fallas%rowtype; v_est text; v_mot text := nullif(btrim(p_motivo_pendiente), '');
  v_nota text := nullif(btrim(p_nota), ''); v_nombre text;
begin
  r := public._reparacion_autorizada(p_falla_id);
  select * into f from public.fallas where id = p_falla_id for update;
  if exists (select 1 from public.fallas o where o.id <> f.id and o.estado not in ('reparada', 'cerrada')
               and ((f.tipo = 'punto' and o.ref_punto_gid = f.ref_punto_gid
                     and (o.uso_grupo is null or f.uso_grupo is null or o.uso_grupo = f.uso_grupo))
                 or (f.tipo = 'linea' and o.ref_circuito_gid = f.ref_circuito_gid))) then
    raise exception 'No se puede quitar: ya hay otra falla activa de esa luminaria (o circuito)';
  end if;
  select nombre into v_nombre from public.usuarios where id = auth.uid();

  v_est := case when v_mot is not null then 'pendiente'
                when f.pendiente_por is not null then 'pendiente'
                when coalesce(f.es_reiterada, false) then 'reiterada'
                else 'reportada' end;

  perform set_config('app.editando_falla', '1', true);

  insert into public.reparaciones_anuladas (falla_id, ot, reparado_por, fecha_reparacion, descripcion, anulada_por, nueva_situacion)
  values (f.id, f.ot, r.reparado_por, r.fecha_reparacion, r.descripcion, auth.uid(), v_est);

  delete from public.reparaciones where falla_id = p_falla_id;
  -- se conservan: el comentario del camión queda como "reparación anulada" y sus fotos quedan marcadas
  update public.fallas_comentarios set tipo = 'reparacion_anulada' where falla_id = p_falla_id and tipo = 'reparacion';
  if not exists (select 1 from public.fallas_comentarios where falla_id = p_falla_id and tipo = 'reparacion_anulada') then
    insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre, creado_en)
      values (p_falla_id, 'reparacion_anulada', r.descripcion, r.reparado_por,
              (select nombre from public.usuarios where id = r.reparado_por), r.creado_en);
  end if;
  update public.fallas_fotos set anulada_en = now() where falla_id = p_falla_id and anulada_en is null;

  if v_mot is not null then
    update public.fallas set estado = 'pendiente', pendiente_por = auth.uid(), fecha_pendiente = now(), motivo_pendiente = v_mot
      where id = p_falla_id;
    insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
      values (p_falla_id, 'pendiente', v_mot, auth.uid(), v_nombre);
    update public.fallas set estado = 'pendiente', pendiente_por = auth.uid(), fecha_pendiente = now(), motivo_pendiente = v_mot
      where circuito_origen_id = p_falla_id;
  else
    update public.fallas set estado = v_est where id = p_falla_id;
    update public.fallas set estado = case when v_est = 'pendiente' then 'pendiente' else 'reportada' end
      where circuito_origen_id = p_falla_id;
    insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
      values (p_falla_id, 'revision', coalesce(v_nota, 'Reparación anulada'), auth.uid(), v_nombre);
  end if;

  perform set_config('app.editando_falla', '', true);
  return jsonb_build_object('falla_id', p_falla_id, 'estado', v_est);
end $$;
grant execute on function public.anular_reparacion(uuid, text, text) to authenticated;
