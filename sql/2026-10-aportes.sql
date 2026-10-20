-- APORTES: el camión (cuadrilla) marca un punto o circuito, indica la falla y registra de inmediato su reparación,
-- con foto de antes y de después y el nombre del maestro que la hizo. Queda como una falla normal, marcada como aporte.
-- Se puede ejecutar más de una vez.

-- 1) Maestros: lista por contrato. La mantienen los contratistas del contrato y el admin (no se borran, se desactivan).
create table if not exists public.maestros (
  id          uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id),
  nombre      text not null check (char_length(btrim(nombre)) between 2 and 60),
  activo      boolean not null default true,
  creado_por  uuid default auth.uid(),
  creado_en   timestamptz not null default now()
);
create unique index if not exists maestros_contrato_nombre_uq on public.maestros (contrato_id, lower(btrim(nombre)));
alter table public.maestros enable row level security;

drop policy if exists maestros_select on public.maestros;
create policy maestros_select on public.maestros for select to authenticated using (
  public.mi_rol() in ('admin', 'observador')
  or exists (select 1 from public.usuario_contratos uc where uc.usuario_id = auth.uid() and uc.contrato_id = maestros.contrato_id)
);
drop policy if exists maestros_insert on public.maestros;
create policy maestros_insert on public.maestros for insert to authenticated with check (
  public.mi_rol() = 'admin'
  or (public.mi_rol() in ('contratista', 'contratista2', 'contratista3')
      and exists (select 1 from public.usuario_contratos uc where uc.usuario_id = auth.uid() and uc.contrato_id = maestros.contrato_id))
);
drop policy if exists maestros_update on public.maestros;
create policy maestros_update on public.maestros for update to authenticated using (
  public.mi_rol() = 'admin'
  or (public.mi_rol() in ('contratista', 'contratista2', 'contratista3')
      and exists (select 1 from public.usuario_contratos uc where uc.usuario_id = auth.uid() and uc.contrato_id = maestros.contrato_id))
) with check (
  public.mi_rol() = 'admin'
  or (public.mi_rol() in ('contratista', 'contratista2', 'contratista3')
      and exists (select 1 from public.usuario_contratos uc where uc.usuario_id = auth.uid() and uc.contrato_id = maestros.contrato_id))
);

-- 2) Marca de aporte en la falla, y foto "antes" / "después"
alter table public.fallas add column if not exists es_aporte boolean not null default false;
alter table public.fallas add column if not exists maestro_id uuid references public.maestros(id);
alter table public.fallas_fotos add column if not exists momento text;
alter table public.fallas_fotos drop constraint if exists fallas_fotos_momento_check;
alter table public.fallas_fotos add constraint fallas_fotos_momento_check check (momento is null or momento in ('antes', 'despues'));

-- 3) El comentario del historial puede ser de tipo 'aporte'
alter table public.fallas_comentarios drop constraint if exists fallas_comentarios_tipo_check;
alter table public.fallas_comentarios add constraint fallas_comentarios_tipo_check
  check (tipo = any (array['reporte', 'asignacion', 'pendiente', 'reparacion', 'masivo', 'comentario', 'aporte']));

-- 4) El camión puede crear la falla solo a través del aporte
create or replace function public.validar_creador_falla()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare
  rol_creador text;
begin
  select rol into rol_creador from public.usuarios where id = new.creado_por;
  if coalesce(current_setting('app.aporte', true), '') = '1' and rol_creador = 'camion' then
    return new;
  end if;
  if rol_creador not in ('ito', 'ito2', 'admin', 'contratista2', 'contratista3') then
    raise exception 'Solo un usuario con rol ITO, ITO2, Contratista2 o Admin puede crear una falla';
  end if;
  return new;
end;
$function$;

-- 5) Un aporte no manda los avisos de "falla nueva" ni "reparada": manda su propio aviso al contratista
create or replace function public.push_falla_nueva()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_dest uuid[]; v_t jsonb;
begin
  if coalesce(current_setting('app.aporte', true), '') = '1' then return NEW; end if;
  select array_agg(u.id) into v_dest from usuarios u
   where u.rol in ('contratista','contratista2', 'contratista3')
     and u.id is distinct from coalesce(NEW.creado_por, NEW.informado_por)
     and (NEW.contrato_id is null
          or exists (select 1 from usuario_contratos uc where uc.usuario_id = u.id and uc.contrato_id = NEW.contrato_id));
  v_t := push_texto_falla(NEW.id, 'nueva');
  perform notificar_push(v_dest, v_t->>'titulo', v_t->>'cuerpo', './?falla=' || NEW.id);
  return NEW;
exception when others then raise warning 'push_falla_nueva: %', sqlerrm; return NEW;
end $function$;

create or replace function public.push_falla_reparada()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_dest uuid[]; v_t jsonb; v_repara uuid;
begin
  if coalesce(current_setting('app.aporte', true), '') = '1' then return NEW; end if;
  select r.reparado_por into v_repara from reparaciones r
   where r.falla_id = NEW.id order by r.creado_en desc limit 1;
  select array_agg(distinct u.id) into v_dest from usuarios u
   where (u.id = coalesce(NEW.informado_por, NEW.creado_por) and u.rol in ('ito','ito2','admin'))
      or (NEW.contrato_id is not null
          and u.rol in ('contratista','contratista2', 'contratista3')
          and u.id is distinct from v_repara
          and exists (select 1 from usuario_contratos uc where uc.usuario_id = u.id and uc.contrato_id = NEW.contrato_id));
  v_t := push_texto_falla(NEW.id, 'reparada');
  perform notificar_push(v_dest, v_t->>'titulo', v_t->>'cuerpo', './?falla=' || NEW.id);
  return NEW;
exception when others then raise warning 'push_falla_reparada: %', sqlerrm; return NEW;
end $function$;

-- 6) La reparación de un aporte no se puede quitar ni editar por el camión (si se equivocó, lo corrige el admin)
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
  elsif v_rol in ('contratista','contratista2','contratista3','camion') and r.reparado_por = auth.uid()
        and r.creado_en > now() - interval '30 minutes' then
    v_seg := greatest(0, extract(epoch from (r.creado_en + interval '30 minutes' - now()))::integer);
  else
    return jsonb_build_object('puede', false);
  end if;
  select exists (select 1 from public.fallas o where o.id <> f.id and o.estado <> 'reparada'
                   and ((f.tipo = 'punto' and o.ref_punto_gid = f.ref_punto_gid)
                     or (f.tipo = 'linea' and o.ref_circuito_gid = f.ref_circuito_gid))) into v_otra;
  return jsonb_build_object('puede', true, 'segundos', v_seg, 'bloqueada_por_otra_falla', v_otra,
    'descripcion', r.descripcion, 'tipo_falla', f.tipo_falla, 'tipo', f.tipo, 'descripcion_otro', f.descripcion_otro,
    'orden_externa', f.orden_externa);
end $function$;

-- 7) Registrar el aporte completo en una sola operación (falla + fotos + reparación + aviso)
--    p_falla_id lo genera la app: las fotos ya se subieron a esa carpeta antes de llamar.
--    p_fotos: [{"ruta": "...", "bytes": 12345, "momento": "antes" | "despues"}, ...]
create or replace function public.registrar_aporte(
  p_falla_id uuid, p_contrato_id uuid, p_tipo text, p_gid integer, p_tipo_falla text,
  p_cardinalidad text, p_comentario text, p_maestro_id uuid, p_reparacion text, p_fotos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_camion text; v_maestro text; v_maestro_contrato uuid; v_maestro_activo boolean;
  v_desc text := nullif(btrim(p_comentario), '');
  v_rep  text := nullif(btrim(p_reparacion), '');
  v_ot text; v_n integer := 0; v_antes integer := 0; v_despues integer := 0; v_total integer := 0;
  v_foto jsonb; v_dest uuid[]; v_calle text; v_existente public.fallas%rowtype;
begin
  if v_uid is null then raise exception 'Sin sesión'; end if;
  select rol, nombre into v_rol, v_camion from public.usuarios where id = v_uid;
  if v_rol is null or v_rol not in ('camion', 'admin') then
    raise exception 'Solo un camión puede registrar un aporte';
  end if;

  -- Si la respuesta anterior se perdió y la app reintenta, no se duplica
  select * into v_existente from public.fallas where id = p_falla_id;
  if found then
    if v_existente.es_aporte and v_existente.creado_por = v_uid then
      return jsonb_build_object('id', v_existente.id, 'ot', v_existente.ot, 'repetido', true);
    end if;
    raise exception 'Identificador de aporte no válido';
  end if;

  if v_rol = 'camion' and not exists (select 1 from public.usuario_contratos where usuario_id = v_uid and contrato_id = p_contrato_id) then
    raise exception 'No perteneces a ese contrato';
  end if;
  select nombre, contrato_id, activo into v_maestro, v_maestro_contrato, v_maestro_activo from public.maestros where id = p_maestro_id;
  if v_maestro is null or v_maestro_contrato is distinct from p_contrato_id or not v_maestro_activo then
    raise exception 'El maestro no es válido para este contrato';
  end if;

  if p_tipo not in ('punto', 'circuito') then raise exception 'Tipo no válido'; end if;
  if p_tipo = 'punto' then
    if not exists (select 1 from public.puntos_luminarios where gid = p_gid and activo) then raise exception 'El punto lumínico no existe o está inactivo'; end if;
    if p_tipo_falla is null or not (p_tipo_falla = any (array['F01','F02','F03','F04','F05','F22','F23','F29','F32','F33','F35','F38','F43','OTRO'])) then
      raise exception 'Código de falla no válido para un punto';
    end if;
    if p_cardinalidad is not null and not (p_cardinalidad = any (array['N','S','P','O'])) then raise exception 'Cardinalidad no válida'; end if;
    if exists (select 1 from public.fallas where tipo = 'punto' and ref_punto_gid = p_gid and not cascada and estado <> 'reparada') then
      raise exception 'Ya hay una falla abierta en este punto: se repara desde su ventana, no como aporte';
    end if;
  else
    if not exists (select 1 from public.circuitos where gid = p_gid and activo) then raise exception 'El circuito no existe o está inactivo'; end if;
    if p_tipo_falla is null or not (p_tipo_falla = any (array['F02','F03','F30','F31','F45','F46','OTRO'])) then
      raise exception 'Código de falla no válido para un circuito';
    end if;
    if exists (select 1 from public.fallas where tipo = 'linea' and ref_circuito_gid = p_gid and not cascada and estado <> 'reparada') then
      raise exception 'Ya hay una falla abierta en este circuito: se repara desde su ventana, no como aporte';
    end if;
  end if;
  if p_tipo_falla = 'OTRO' and v_desc is null then raise exception 'Describe la falla (obligatorio si es OTRO)'; end if;
  if v_rep is null then raise exception 'Indica el trabajo realizado'; end if;

  if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' then raise exception 'Faltan las fotografías'; end if;
  for v_foto in select * from jsonb_array_elements(p_fotos) loop
    v_total := v_total + 1;
    if left(coalesce(v_foto->>'ruta', ''), length(p_falla_id::text) + 1) <> p_falla_id::text || '/' then raise exception 'Ruta de foto no válida'; end if;
    if v_foto->>'momento' = 'antes' then v_antes := v_antes + 1;
    elsif v_foto->>'momento' = 'despues' then v_despues := v_despues + 1;
    else raise exception 'Cada foto debe ser de antes o de después'; end if;
  end loop;
  if v_antes < 1 or v_despues < 1 then raise exception 'El aporte exige una foto de antes y una de después'; end if;
  if v_total > 3 then raise exception 'Máximo 3 fotos por falla'; end if;

  perform set_config('app.aporte', '1', true);
  perform set_config('app.editando_falla', '1', true);

  if p_tipo = 'punto' then
    insert into public.fallas (id, tipo, ref_punto_gid, tipo_falla, cardinalidad, descripcion_otro, cascada, creado_por, fecha_falla,
                               contrato_id, es_aporte, maestro_id, asignado_camion_id, asignado_por_id, fecha_asignacion)
    values (p_falla_id, 'punto', p_gid, p_tipo_falla, p_cardinalidad, v_desc, false, v_uid, now(),
            p_contrato_id, true, p_maestro_id, v_uid, v_uid, now())
    returning ot into v_ot;
  else
    insert into public.fallas (id, tipo, ref_circuito_gid, tipo_falla, descripcion_otro, cascada, creado_por, fecha_falla,
                               contrato_id, es_aporte, maestro_id, asignado_camion_id, asignado_por_id, fecha_asignacion)
    values (p_falla_id, 'linea', p_gid, p_tipo_falla, v_desc, false, v_uid, now(),
            p_contrato_id, true, p_maestro_id, v_uid, v_uid, now())
    returning ot into v_ot;
    insert into public.fallas (tipo, ref_punto_gid, tipo_falla, descripcion_otro, cascada, circuito_origen_id, creado_por, fecha_falla, es_aporte, maestro_id)
    select 'punto', p.gid, p_tipo_falla, v_desc, true, p_falla_id, v_uid, now(), true, p_maestro_id
    from public.puntos_luminarios p join public.circuitos c on c.n_cliente = p.n_cliente
    where c.gid = p_gid;
    get diagnostics v_n = row_count;
  end if;

  if v_desc is not null then
    insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
    values (p_falla_id, 'reporte', v_desc, v_uid, v_camion);
  end if;
  insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
  values (p_falla_id, 'aporte', 'Aporte de ' || v_camion || ' · maestro ' || v_maestro, v_uid, v_camion);

  for v_foto in select * from jsonb_array_elements(p_fotos) loop
    insert into public.fallas_fotos (falla_id, ruta, bytes, subido_por, momento)
    values (p_falla_id, v_foto->>'ruta', coalesce((v_foto->>'bytes')::integer, 0), v_uid, v_foto->>'momento');
  end loop;

  perform public.registrar_reparacion(p_falla_id, v_rep);

  -- Aviso a los contratistas del contrato
  select array_agg(u.id) into v_dest from public.usuarios u
   where u.rol in ('contratista', 'contratista2', 'contratista3')
     and exists (select 1 from public.usuario_contratos uc where uc.usuario_id = u.id and uc.contrato_id = p_contrato_id);
  if p_tipo = 'punto' then
    select nullif(initcap(lower(btrim(calle_1))), '') into v_calle from public.puntos_luminarios where gid = p_gid;
  end if;
  perform public.notificar_push(v_dest, 'Aporte registrado',
    concat_ws(E'\n', v_camion || ' · maestro ' || v_maestro || ' realizó un aporte',
              concat_ws(' · ', v_calle, 'OS ' || v_ot, p_tipo_falla)),
    './?falla=' || p_falla_id);

  perform set_config('app.aporte', '', true);
  perform set_config('app.editando_falla', '', true);
  return jsonb_build_object('id', p_falla_id, 'ot', v_ot, 'puntos', v_n);
end $function$;

revoke all on function public.registrar_aporte(uuid, uuid, text, integer, text, text, text, uuid, text, jsonb) from public;
grant execute on function public.registrar_aporte(uuid, uuid, text, integer, text, text, text, uuid, text, jsonb) to authenticated;
