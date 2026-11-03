-- Deshacer una reparación con segunda falla en el punto: solo bloquea si hay otra falla activa del MISMO uso
-- (vial/peatonal) en el punto, o del mismo circuito. Antes bloqueaba con cualquier otra falla activa del punto.
-- Cambia reparacion_estado (lo que ve la ficha) y anular_reparacion (lo que hace). Se puede ejecutar más de una vez.

create or replace function public.reparacion_estado(p_falla_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_rol text; f public.fallas%rowtype; r public.reparaciones%rowtype; v_seg integer; v_otra boolean;
begin
  select rol into v_rol from public.usuarios where id = auth.uid();
  select * into f from public.fallas where id = p_falla_id;
  if not found or f.cascada or f.estado <> 'reparada' then return jsonb_build_object('puede', false); end if;
  if f.es_aporte and v_rol is distinct from 'admin' then return jsonb_build_object('puede', false); end if;
  select * into r from public.reparaciones where falla_id = p_falla_id order by creado_en desc limit 1;
  if not found then return jsonb_build_object('puede', false); end if;
  if v_rol = 'admin' then
    v_seg := null;
  elsif public.tiene_permiso('reparacion_editar_propia') and r.reparado_por = auth.uid()
        and r.creado_en > now() - interval '30 minutes' then
    v_seg := greatest(0, extract(epoch from (r.creado_en + interval '30 minutes' - now()))::integer);
  else
    return jsonb_build_object('puede', false);
  end if;
  select exists (select 1 from public.fallas o where o.id <> f.id and o.estado <> 'reparada'
                   and ((f.tipo = 'punto' and o.ref_punto_gid = f.ref_punto_gid
                         and (o.uso_grupo is null or f.uso_grupo is null or o.uso_grupo = f.uso_grupo))
                     or (f.tipo = 'linea' and o.ref_circuito_gid = f.ref_circuito_gid))) into v_otra;
  return jsonb_build_object('puede', true, 'segundos', v_seg, 'bloqueada_por_otra_falla', v_otra,
    'descripcion', r.descripcion, 'tipo_falla', f.tipo_falla, 'tipo', f.tipo, 'descripcion_otro', f.descripcion_otro,
    'orden_externa', f.orden_externa);
end $function$;

create or replace function public.anular_reparacion(p_falla_id uuid, p_motivo_pendiente text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r public.reparaciones; f public.fallas%rowtype; v_est text; v_mot text := nullif(btrim(p_motivo_pendiente), ''); v_nombre text;
begin
  r := public._reparacion_autorizada(p_falla_id);
  select * into f from public.fallas where id = p_falla_id for update;
  if exists (select 1 from public.fallas o where o.id <> f.id and o.estado <> 'reparada'
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
end $function$;

-- Comprobación: debe devolver 2 filas
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('reparacion_estado', 'anular_reparacion');
