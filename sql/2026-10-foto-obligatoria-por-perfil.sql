-- La foto de reparación es obligatoria SOLO para los perfiles con "foto obligatoria" (web y app por igual).
-- Quita el salto que dejó "registrar_reparacion_web" (sql/2026-10-cierre-desde-web.sql):
-- ahora, quien tiene foto obligatoria debe subir al menos 1 foto también desde el computador.

create or replace function public.exigir_foto_reparacion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce((select foto_obligatoria from usuarios where id = new.reparado_por), false)
     and not exists (select 1 from fallas_fotos where falla_id = new.falla_id) then
    raise exception 'Esta reparación exige al menos una fotografía';
  end if;
  return new;
end $function$;

create or replace function public.registrar_reparacion(p_falla_id uuid, p_descripcion text)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_desc  text := nullif(btrim(p_descripcion), '');
  f       public.fallas%rowtype;
  v_casc  integer;
begin
  if v_uid is null then raise exception 'Sin sesión'; end if;
  if v_desc is null then raise exception 'La descripción no puede estar vacía'; end if;

  select * into f from public.fallas where id = p_falla_id;
  if not found then raise exception 'La falla no existe o no tienes acceso a ella'; end if;
  if f.cascada then
    raise exception 'Los puntos de un circuito se cierran reparando la falla del circuito';
  end if;
  if f.estado = 'reparada' then
    raise exception 'La falla ya está reparada';
  end if;
  if coalesce((select foto_obligatoria from public.usuarios where id = v_uid), false)
     and not exists (select 1 from public.fallas_fotos where falla_id = p_falla_id) then
    raise exception 'Esta reparación exige al menos una fotografía';
  end if;

  insert into public.reparaciones (falla_id, reparado_por, descripcion)
  values (p_falla_id, v_uid, v_desc);

  insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
  values (p_falla_id, 'reparacion', v_desc, v_uid, (select nombre from public.usuarios where id = v_uid));

  select count(*)::integer into v_casc
  from public.fallas where circuito_origen_id = p_falla_id and estado = 'reparada';

  return jsonb_build_object('falla_id', p_falla_id, 'puntos_cerrados', v_casc);
end;
$function$;

-- La función que usaba el salto ya no se necesita
drop function if exists public.registrar_reparacion_web(uuid, text);

-- Verificación: debe devolver 3 filas con true
select 'registrar_reparacion sin salto' as f,
       pg_get_functiondef('public.registrar_reparacion(uuid,text)'::regprocedure) not like '%cierre_web%' as ok
union all
select 'exigir_foto_reparacion sin salto',
       pg_get_functiondef('public.exigir_foto_reparacion()'::regprocedure) not like '%cierre_web%'
union all
select 'registrar_reparacion_web eliminada', to_regprocedure('public.registrar_reparacion_web(uuid,text)') is null;
