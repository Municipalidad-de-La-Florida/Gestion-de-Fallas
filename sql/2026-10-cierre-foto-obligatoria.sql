-- Toda reparación exige al menos 1 fotografía (web y app), para todos los usuarios.
-- Desde el SQL Editor (sin sesión de usuario) no se exige, para poder hacer correcciones de mantención.

create or replace function public.exigir_foto_reparacion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;   -- mantención (SQL Editor)
  end if;
  if not exists (select 1 from fallas_fotos where falla_id = new.falla_id) then
    raise exception 'Toda reparación exige al menos una fotografía';
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
  if not exists (select 1 from public.fallas_fotos where falla_id = p_falla_id) then
    raise exception 'Toda reparación exige al menos una fotografía';
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

-- Verificación: debe devolver 2 filas con true (ya no dependen de "foto_obligatoria")
select 'registrar_reparacion' as f,
       pg_get_functiondef('public.registrar_reparacion(uuid,text)'::regprocedure) not like '%foto_obligatoria%' as ok
union all
select 'exigir_foto_reparacion',
       pg_get_functiondef('public.exigir_foto_reparacion()'::regprocedure) not like '%foto_obligatoria%';
