-- Editar / quitar una reparación: solo quien la registró, dentro de los 10 minutos siguientes (el admin siempre).
-- Ejecutar completo en el SQL Editor (elegir "Run without RLS" si pregunta). Idempotente.

-- Registro de las reparaciones quitadas (trazabilidad; solo lo ve el admin)
create table if not exists public.reparaciones_anuladas (
  id uuid primary key default gen_random_uuid(),
  falla_id uuid, ot integer, reparado_por uuid, fecha_reparacion timestamptz, descripcion text,
  anulada_por uuid, anulada_en timestamptz not null default now(), nueva_situacion text
);
alter table public.reparaciones_anuladas enable row level security;
drop policy if exists reparaciones_anuladas_admin on public.reparaciones_anuladas;
create policy reparaciones_anuladas_admin on public.reparaciones_anuladas for select to authenticated
  using (public.mi_rol() = 'admin');

-- ¿Puede el usuario actual editar/quitar la reparación de esta falla? (ventana de 10 minutos desde que se registró)
create or replace function public.reparacion_estado(p_falla_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_rol text; f public.fallas%rowtype; r public.reparaciones%rowtype; v_seg integer; v_otra boolean;
begin
  select rol into v_rol from public.usuarios where id = auth.uid();
  select * into f from public.fallas where id = p_falla_id;
  if not found or f.cascada or f.estado <> 'reparada' then return jsonb_build_object('puede', false); end if;
  select * into r from public.reparaciones where falla_id = p_falla_id order by creado_en desc limit 1;
  if not found then return jsonb_build_object('puede', false); end if;
  if v_rol = 'admin' then
    v_seg := null;
  elsif v_rol in ('contratista','contratista2','contratista3','camion') and r.reparado_por = auth.uid()
        and r.creado_en > now() - interval '10 minutes' then
    v_seg := greatest(0, extract(epoch from (r.creado_en + interval '10 minutes' - now()))::integer);
  else
    return jsonb_build_object('puede', false);
  end if;
  select exists (select 1 from public.fallas o where o.id <> f.id and o.estado <> 'reparada'
                   and ((f.tipo = 'punto' and o.ref_punto_gid = f.ref_punto_gid)
                     or (f.tipo = 'linea' and o.ref_circuito_gid = f.ref_circuito_gid))) into v_otra;
  return jsonb_build_object('puede', true, 'segundos', v_seg, 'bloqueada_por_otra_falla', v_otra,
    'descripcion', r.descripcion, 'tipo_falla', f.tipo_falla, 'tipo', f.tipo, 'descripcion_otro', f.descripcion_otro,
    'orden_externa', f.orden_externa);
end $$;

-- Autorización común
create or replace function public._reparacion_autorizada(p_falla_id uuid)
returns public.reparaciones language plpgsql stable security definer set search_path to 'public' as $$
declare r public.reparaciones; v jsonb;
begin
  v := public.reparacion_estado(p_falla_id);
  if not coalesce((v->>'puede')::boolean, false) then
    raise exception 'No puedes modificar esta reparación (solo quien la registró, dentro de 10 minutos, o el admin)';
  end if;
  select * into r from public.reparaciones where falla_id = p_falla_id order by creado_en desc limit 1;
  return r;
end $$;

-- Quitar la reparación: la falla vuelve a su estado anterior (o queda pendiente si se entrega un motivo)
create or replace function public.anular_reparacion(p_falla_id uuid, p_motivo_pendiente text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r public.reparaciones; f public.fallas%rowtype; v_est text; v_mot text := nullif(btrim(p_motivo_pendiente), ''); v_nombre text;
begin
  r := public._reparacion_autorizada(p_falla_id);
  select * into f from public.fallas where id = p_falla_id for update;
  if exists (select 1 from public.fallas o where o.id <> f.id and o.estado <> 'reparada'
               and ((f.tipo = 'punto' and o.ref_punto_gid = f.ref_punto_gid)
                 or (f.tipo = 'linea' and o.ref_circuito_gid = f.ref_circuito_gid))) then
    raise exception 'No se puede quitar: ya hay otra falla activa en este mismo punto o circuito';
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
  delete from public.fallas_comentarios where falla_id = p_falla_id and tipo = 'reparacion';
  delete from public.fallas_fotos where falla_id = p_falla_id;

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
  end if;

  perform set_config('app.editando_falla', '', true);
  return jsonb_build_object('falla_id', p_falla_id, 'estado', v_est);
end $$;

-- Editar la reparación (trabajo realizado) y/o los datos de la falla
create or replace function public.editar_reparacion(p_falla_id uuid, p_cambios jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.reparaciones; f public.fallas%rowtype;
  v_desc text; v_tipo text; v_otro text; v_oe text; v_codigos text[]; v_nombre text;
begin
  r := public._reparacion_autorizada(p_falla_id);
  select * into f from public.fallas where id = p_falla_id for update;
  select nombre into v_nombre from public.usuarios where id = auth.uid();

  perform set_config('app.editando_falla', '1', true);

  if p_cambios ? 'descripcion' then
    v_desc := nullif(btrim(p_cambios->>'descripcion'), '');
    if v_desc is null then raise exception 'La descripción de la reparación no puede estar vacía'; end if;
    update public.reparaciones set descripcion = v_desc where id = r.id;
    if exists (select 1 from public.fallas_comentarios where falla_id = p_falla_id and tipo = 'reparacion') then
      update public.fallas_comentarios set comentario = v_desc where falla_id = p_falla_id and tipo = 'reparacion';
    else
      insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
        values (p_falla_id, 'reparacion', v_desc, auth.uid(), v_nombre);
    end if;
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

-- Quitar una foto de la reparación
create or replace function public.quitar_foto_reparacion(p_foto_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_falla uuid; r public.reparaciones;
begin
  select falla_id into v_falla from public.fallas_fotos where id = p_foto_id;
  if v_falla is null then raise exception 'La foto no existe'; end if;
  r := public._reparacion_autorizada(v_falla);
  if coalesce((select foto_obligatoria from public.usuarios where id = auth.uid()), false)
     and (select count(*) from public.fallas_fotos where falla_id = v_falla) <= 1 then
    raise exception 'Tu perfil exige al menos una fotografía: agrega otra antes de quitar esta';
  end if;
  delete from public.fallas_fotos where id = p_foto_id;
end $$;

grant execute on function public.reparacion_estado(uuid) to authenticated;
grant execute on function public.anular_reparacion(uuid, text) to authenticated;
grant execute on function public.editar_reparacion(uuid, jsonb) to authenticated;
grant execute on function public.quitar_foto_reparacion(uuid) to authenticated;
