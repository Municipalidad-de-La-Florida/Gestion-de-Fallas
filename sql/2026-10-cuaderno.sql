-- CUADERNO COMPARTIDO (solo app) · anotaciones temporales de fallas que aún no se informan.
-- Se puede ejecutar más de una vez. Orden: este SQL → web → app.
--  · La falla NO existe (ni OT, ni avisos) hasta que alguien pincha «Informar»: ahí se crea con la fecha y hora de ese momento.
--  · Una sola anotación por punto o circuito; la ven y editan todos los habilitados; elimina quien la anotó o el admin.
--  · Duran 5 días desde que se crean (editar no reinicia el plazo). Si se informa una falla en ese punto/circuito, la anotación se quita sola.

-- 1) Permiso por usuario -----------------------------------------------------------------------------------------
alter table public.usuarios add column if not exists ver_cuaderno boolean not null default false;

insert into public.funciones (clave, grupo, nombre, orden, por_usuario)
values ('cuaderno', 'Informar', 'Cuaderno (anotar fallas sin informar)', 50, true)
on conflict (clave) do update set grupo = excluded.grupo, nombre = excluded.nombre, orden = excluded.orden, por_usuario = excluded.por_usuario;

insert into public.perfil_funciones (perfil, funcion, habilitado)
select p.clave, 'cuaderno', false from public.perfiles p
on conflict (perfil, funcion) do nothing;

create or replace function public.usuario_tiene_permiso(p_usuario uuid, p_funcion text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare u public.usuarios%rowtype; v_ok boolean;
begin
  if p_usuario is null then return false; end if;
  select * into u from public.usuarios where id = p_usuario;
  if not found then return false; end if;
  select pf.habilitado into v_ok from public.perfil_funciones pf where pf.perfil = u.perfil and pf.funcion = p_funcion;
  if coalesce(v_ok, false) then return true; end if;
  return coalesce(case p_funcion
    when 'notificador_externo'    then u.notificador_externo_habilitado
    when 'pasar_a_masivo'         then u.puede_pasar_a_masivo
    when 'foto_obligatoria'       then u.foto_obligatoria
    when 'rendimiento_cuadrillas' then u.ver_cuadrillas
    when 'fiscalizacion'          then u.ver_fiscalizacion
    when 'ubicacion_camiones'     then u.ver_ubicacion
    when 'informe_reparaciones'   then u.ver_informe_rep
    when 'cuaderno'               then u.ver_cuaderno
    else false end, false);
end;
$function$;
revoke all on function public.usuario_tiene_permiso(uuid, text) from public, anon;
grant execute on function public.usuario_tiene_permiso(uuid, text) to authenticated;

-- 2) Tablas -------------------------------------------------------------------------------------------------------
create table if not exists public.cuaderno_fallas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('punto', 'circuito')),
  ref_punto_gid integer,
  ref_circuito_gid integer,
  tipo_falla text not null,
  descripcion text,
  uso_grupo text,
  contrato_id uuid,
  mantenedor_id uuid,
  masivo boolean not null default false,
  anotado_por uuid not null,
  anotado_en timestamptz not null default now(),
  editado_por uuid,
  editado_en timestamptz,
  expira_en timestamptz not null default now() + interval '5 days',
  check ((tipo = 'punto' and ref_punto_gid is not null and ref_circuito_gid is null)
      or (tipo = 'circuito' and ref_circuito_gid is not null and ref_punto_gid is null))
);
create unique index if not exists cuaderno_uq_punto on public.cuaderno_fallas (ref_punto_gid) where ref_punto_gid is not null;
create unique index if not exists cuaderno_uq_circuito on public.cuaderno_fallas (ref_circuito_gid) where ref_circuito_gid is not null;
create index if not exists cuaderno_anotado_en on public.cuaderno_fallas (anotado_en desc);
alter table public.cuaderno_fallas enable row level security;
revoke all on public.cuaderno_fallas from public, anon, authenticated;   -- todo pasa por las funciones de abajo

create table if not exists public.cuaderno_log (
  id bigserial primary key,
  fecha timestamptz not null default now(),
  accion text not null,            -- anotó | editó | informó | eliminó | venció
  usuario_id uuid,
  anotado_por uuid,
  tipo text, ref_punto_gid integer, ref_circuito_gid integer, tipo_falla text, detalle text
);
alter table public.cuaderno_log enable row level security;
revoke all on public.cuaderno_log from public, anon, authenticated;

create or replace function public._cuaderno_ok() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.tiene_permiso('cuaderno') then raise exception 'No tienes habilitado el Cuaderno'; end if;
end $$;
revoke all on function public._cuaderno_ok() from public, anon;
grant execute on function public._cuaderno_ok() to authenticated;

-- 3) Anotar -------------------------------------------------------------------------------------------------------
create or replace function public.cuaderno_agregar(
  p_tipo text, p_gid integer, p_tipo_falla text, p_descripcion text default null,
  p_uso_grupo text default null, p_contrato_id uuid default null, p_mantenedor_id uuid default null, p_masivo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_desc text := nullif(btrim(p_descripcion), ''); v_ex record; v_id uuid;
begin
  perform public._cuaderno_ok();
  if p_tipo not in ('punto', 'circuito') then raise exception 'Tipo no válido'; end if;
  if p_tipo_falla is null or p_tipo_falla !~ '^(F[0-9]{2}|OTRO)$' then raise exception 'Código de falla no válido'; end if;
  if p_tipo_falla = 'OTRO' and v_desc is null then raise exception 'Describe la falla (obligatorio si es OTRO)'; end if;
  if p_tipo = 'punto' and not exists (select 1 from puntos_luminarios where gid = p_gid and activo) then raise exception 'El punto lumínico no existe o está inactivo'; end if;
  if p_tipo = 'circuito' and not exists (select 1 from circuitos where gid = p_gid and activo) then raise exception 'El circuito no existe o está inactivo'; end if;

  select c.id, c.tipo_falla, c.anotado_en, u.nombre as nombre into v_ex
    from cuaderno_fallas c left join usuarios u on u.id = c.anotado_por
   where c.expira_en > now() and ((p_tipo = 'punto' and c.ref_punto_gid = p_gid) or (p_tipo = 'circuito' and c.ref_circuito_gid = p_gid));
  if found then
    return jsonb_build_object('ya_existe', true, 'id', v_ex.id, 'tipo_falla', v_ex.tipo_falla, 'anotado_en', v_ex.anotado_en, 'anotado_por', v_ex.nombre);
  end if;
  delete from cuaderno_fallas where expira_en <= now() and ((p_tipo = 'punto' and ref_punto_gid = p_gid) or (p_tipo = 'circuito' and ref_circuito_gid = p_gid));

  insert into cuaderno_fallas (tipo, ref_punto_gid, ref_circuito_gid, tipo_falla, descripcion, uso_grupo, contrato_id, mantenedor_id, masivo, anotado_por)
  values (p_tipo, case when p_tipo = 'punto' then p_gid end, case when p_tipo = 'circuito' then p_gid end,
          p_tipo_falla, v_desc, nullif(upper(btrim(p_uso_grupo)), ''), p_contrato_id, p_mantenedor_id, coalesce(p_masivo, false), v_uid)
  returning id into v_id;
  insert into cuaderno_log (accion, usuario_id, anotado_por, tipo, ref_punto_gid, ref_circuito_gid, tipo_falla)
  values ('anotó', v_uid, v_uid, p_tipo, case when p_tipo = 'punto' then p_gid end, case when p_tipo = 'circuito' then p_gid end, p_tipo_falla);
  return jsonb_build_object('ya_existe', false, 'id', v_id);
end $$;

-- 4) Listar (orden, filtros y búsqueda en el servidor) -----------------------------------------------------------
create or replace function public.cuaderno_listar(
  p_orden text default 'desc', p_anotador uuid default null, p_codigo text default null, p_tipo text default null,
  p_vencen boolean default false, p_texto text default null, p_limite integer default 40, p_desde integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_txt text := nullif(btrim(p_texto), ''); v_tot integer; v_items jsonb;
begin
  perform public._cuaderno_ok();
  with base as (
    select c.*, u.nombre as anotador,
           pl.llave, pl.nro_mun, nullif(btrim(concat_ws(' ', pl.calle_1, pl.direccion::text)), '') as direccion,
           ci.id as circuito_id, ci.cantidad_luminarias_cliente as cant_lum,
           coalesce(ST_Y(ST_PointOnSurface(pl.geom::geometry)), ST_Y(ST_PointOnSurface(ci.geom::geometry))) as lat,
           coalesce(ST_X(ST_PointOnSurface(pl.geom::geometry)), ST_X(ST_PointOnSurface(ci.geom::geometry))) as lng,
           case when c.tipo = 'circuito' then ST_AsGeoJSON(ci.geom::geometry)::jsonb end as geo
      from cuaderno_fallas c
      left join usuarios u on u.id = c.anotado_por
      left join puntos_luminarios pl on pl.gid = c.ref_punto_gid
      left join circuitos ci on ci.gid = c.ref_circuito_gid
     where c.expira_en > now()
       and (p_anotador is null or c.anotado_por = p_anotador)
       and (nullif(p_codigo, '') is null or c.tipo_falla = p_codigo)
       and (nullif(p_tipo, '') is null or c.tipo = p_tipo)
       and (not coalesce(p_vencen, false) or c.expira_en <= now() + interval '24 hours')
       and (v_txt is null or concat_ws(' ', pl.calle_1, pl.direccion::text, pl.llave::text, pl.nro_mun::text, ci.id::text, c.descripcion) ilike '%' || v_txt || '%')
  )
  select (select count(*) from base),
         coalesce(jsonb_agg(to_jsonb(x) order by case when p_orden = 'asc' then x.anotado_en end asc, x.anotado_en desc), '[]'::jsonb)
    into v_tot, v_items
    from (select * from base order by case when p_orden = 'asc' then anotado_en end asc, anotado_en desc
          limit greatest(1, least(coalesce(p_limite, 40), 100)) offset greatest(0, coalesce(p_desde, 0))) x;
  return jsonb_build_object('total', v_tot, 'items', v_items);
end $$;

-- Para el filtro «Anotó»: quiénes tienen anotaciones vigentes
create or replace function public.cuaderno_anotadores()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._cuaderno_ok();
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.anotado_por, 'nombre', x.nombre, 'n', x.n) order by x.nombre)
                     from (select c.anotado_por, u.nombre, count(*) n from cuaderno_fallas c left join usuarios u on u.id = c.anotado_por
                            where c.expira_en > now() group by 1, 2) x), '[]'::jsonb);
end $$;

create or replace function public.cuaderno_contar()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._cuaderno_ok();
  return jsonb_build_object(
    'total', (select count(*) from cuaderno_fallas where expira_en > now()),
    'mias',  (select count(*) from cuaderno_fallas where expira_en > now() and anotado_por = auth.uid()));
end $$;

-- 5) Editar (todos los habilitados): código y comentario. No cambia el plazo. ---------------------------------------
create or replace function public.cuaderno_editar(p_id uuid, p_tipo_falla text, p_descripcion text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_desc text := nullif(btrim(p_descripcion), ''); r cuaderno_fallas%rowtype;
begin
  perform public._cuaderno_ok();
  if p_tipo_falla is null or p_tipo_falla !~ '^(F[0-9]{2}|OTRO)$' then raise exception 'Código de falla no válido'; end if;
  if p_tipo_falla = 'OTRO' and v_desc is null then raise exception 'Describe la falla (obligatorio si es OTRO)'; end if;
  update cuaderno_fallas set tipo_falla = p_tipo_falla, descripcion = v_desc, editado_por = auth.uid(), editado_en = now()
   where id = p_id and expira_en > now() returning * into r;
  if not found then raise exception 'La anotación ya no existe (se informó, se eliminó o venció)'; end if;
  insert into cuaderno_log (accion, usuario_id, anotado_por, tipo, ref_punto_gid, ref_circuito_gid, tipo_falla)
  values ('editó', auth.uid(), r.anotado_por, r.tipo, r.ref_punto_gid, r.ref_circuito_gid, r.tipo_falla);
  return jsonb_build_object('ok', true);
end $$;

-- 6) Eliminar: quien la anotó o el admin ---------------------------------------------------------------------------
create or replace function public.cuaderno_eliminar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r cuaderno_fallas%rowtype;
begin
  perform public._cuaderno_ok();
  select * into r from cuaderno_fallas where id = p_id for update;
  if not found then return jsonb_build_object('ok', true, 'ya_no_estaba', true); end if;
  if r.anotado_por <> auth.uid() and public.mi_rol() <> 'admin' then raise exception 'Solo quien la anotó o un administrador puede eliminarla'; end if;
  delete from cuaderno_fallas where id = p_id;
  insert into cuaderno_log (accion, usuario_id, anotado_por, tipo, ref_punto_gid, ref_circuito_gid, tipo_falla)
  values ('eliminó', auth.uid(), r.anotado_por, r.tipo, r.ref_punto_gid, r.ref_circuito_gid, r.tipo_falla);
  return jsonb_build_object('ok', true);
end $$;

-- 7) Informar: crea la falla real AHORA, a nombre de quien informa. Con inspección abierta intenta entrar a ella. ------
create or replace function public.cuaderno_informar(p_id uuid, p_inspeccion_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r cuaderno_fallas%rowtype; v_dup record; v_res jsonb; v_en_insp boolean := false;
begin
  perform public._cuaderno_ok();
  if not public.tiene_permiso('informar_falla') then raise exception 'No tienes permiso para informar fallas'; end if;
  select * into r from cuaderno_fallas where id = p_id for update;
  if not found then
    return jsonb_build_object('ya_no_esta', true);
  end if;

  -- ¿ya hay una falla activa en ese punto o circuito?
  select f.ot, f.tipo_falla, f.creado_por, u.nombre as informante into v_dup
    from fallas f left join usuarios u on u.id = f.creado_por
   where f.estado <> 'reparada' and not exists (select 1 from reparaciones x where x.falla_id = f.id)
     and ((r.tipo = 'punto' and f.ref_punto_gid = r.ref_punto_gid) or (r.tipo = 'circuito' and f.ref_circuito_gid = r.ref_circuito_gid))
   order by f.fecha_falla desc limit 1;
  if found then
    delete from cuaderno_fallas where id = p_id;
    insert into cuaderno_log (accion, usuario_id, anotado_por, tipo, ref_punto_gid, ref_circuito_gid, tipo_falla, detalle)
    values ('informó', auth.uid(), r.anotado_por, r.tipo, r.ref_punto_gid, r.ref_circuito_gid, r.tipo_falla, 'ya estaba informada: OS ' || coalesce(v_dup.ot, '?'));
    return jsonb_build_object('ya_informada', true, 'ot', v_dup.ot, 'informante', v_dup.informante, 'tipo_falla', v_dup.tipo_falla);
  end if;

  delete from cuaderno_fallas where id = p_id;   -- se quita antes de crear (el trigger de fallas también limpia)
  begin
    if p_inspeccion_id is not null then
      if r.tipo = 'punto' then
        v_res := public.crear_falla_punto(r.ref_punto_gid, r.tipo_falla, null, r.descripcion, null, null, null, p_inspeccion_id, r.masivo, r.uso_grupo, r.contrato_id, r.mantenedor_id);
      else
        v_res := public.crear_falla_circuito(r.ref_circuito_gid, r.tipo_falla, r.descripcion, null, null, null, p_inspeccion_id, r.masivo);
      end if;
      v_en_insp := true;
    end if;
  exception when others then
    v_en_insp := false; v_res := null;   -- la inspección no sirve (otra persona, otro día, vencida…): se informa como falla normal
  end;
  if v_res is null then
    if r.tipo = 'punto' then
      v_res := public.crear_falla_punto(r.ref_punto_gid, r.tipo_falla, null, r.descripcion, null, null, null, null, r.masivo, r.uso_grupo, r.contrato_id, r.mantenedor_id);
    else
      v_res := public.crear_falla_circuito(r.ref_circuito_gid, r.tipo_falla, r.descripcion, null, null, null, null, r.masivo);
    end if;
  end if;
  insert into cuaderno_log (accion, usuario_id, anotado_por, tipo, ref_punto_gid, ref_circuito_gid, tipo_falla, detalle)
  values ('informó', auth.uid(), r.anotado_por, r.tipo, r.ref_punto_gid, r.ref_circuito_gid, r.tipo_falla, 'OS ' || coalesce(v_res->>'ot', '?'));
  return v_res || jsonb_build_object('ya_informada', false, 'en_inspeccion', v_en_insp);
end $$;

-- 8) Si se informa una falla (por cualquier vía) en un punto/circuito anotado, la anotación se quita sola ------------
create or replace function public._cuaderno_limpiar_al_informar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.cuaderno_fallas
   where (NEW.ref_punto_gid is not null and ref_punto_gid = NEW.ref_punto_gid)
      or (NEW.ref_circuito_gid is not null and ref_circuito_gid = NEW.ref_circuito_gid);
  return null;
end $$;
drop trigger if exists trg_cuaderno_limpiar on public.fallas;
create trigger trg_cuaderno_limpiar after insert on public.fallas for each row execute function public._cuaderno_limpiar_al_informar();

-- 9) Limpieza diaria de vencidas (queda en el registro) -------------------------------------------------------------
create or replace function public.cuaderno_limpiar_vencidas() returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with b as (delete from cuaderno_fallas where expira_en <= now() returning *)
  insert into cuaderno_log (accion, usuario_id, anotado_por, tipo, ref_punto_gid, ref_circuito_gid, tipo_falla)
  select 'venció', null, anotado_por, tipo, ref_punto_gid, ref_circuito_gid, tipo_falla from b;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.cuaderno_limpiar_vencidas() from public, anon, authenticated;
do $$ begin
  perform cron.unschedule('cuaderno-limpiar') where exists (select 1 from cron.job where jobname = 'cuaderno-limpiar');
  perform cron.schedule('cuaderno-limpiar', '10 7 * * *', 'select public.cuaderno_limpiar_vencidas()');
exception when others then raise notice 'No se pudo programar la limpieza (pg_cron): %', sqlerrm;
end $$;

-- 10) Resumen para el administrador (quién anota, informa y elimina) ---------------------------------------------------
create or replace function public.cuaderno_resumen_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.mi_rol() <> 'admin' then raise exception 'Solo el administrador'; end if;
  return jsonb_build_object(
    'vigentes', (select count(*) from cuaderno_fallas where expira_en > now()),
    'mas_antigua', (select min(anotado_en) from cuaderno_fallas where expira_en > now()),
    'por_usuario', coalesce((select jsonb_agg(to_jsonb(z) order by z.usuario) from (
        select u.nombre as usuario,
               count(*) filter (where l.accion = 'anotó') as anoto, count(*) filter (where l.accion = 'informó') as informo,
               count(*) filter (where l.accion = 'eliminó') as elimino, count(*) filter (where l.accion = 'venció') as vencidas
          from (select usuario_id, anotado_por, accion from cuaderno_log where fecha > now() - interval '30 days') l
          join usuarios u on u.id = case when l.accion = 'venció' then l.anotado_por else l.usuario_id end
         group by u.id, u.nombre) z), '[]'::jsonb));
end $$;

do $$ declare f text; begin
  foreach f in array array['cuaderno_agregar(text,integer,text,text,text,uuid,uuid,boolean)','cuaderno_listar(text,uuid,text,text,boolean,text,integer,integer)',
    'cuaderno_anotadores()','cuaderno_contar()','cuaderno_editar(uuid,text,text)','cuaderno_eliminar(uuid)','cuaderno_informar(uuid,uuid)','cuaderno_resumen_admin()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
