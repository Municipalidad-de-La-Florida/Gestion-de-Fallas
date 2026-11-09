-- Restringe a qué notificadores puede informar un usuario con permiso de notificador externo.
-- notificadores_permitidos = null: sin restricción. Si tiene lista: solo esos notificadores (o él mismo).
alter table public.usuarios add column if not exists notificadores_permitidos uuid[];
comment on column public.usuarios.notificadores_permitidos is 'Si no es null, el usuario (con permiso de notificador externo) solo puede informar a nombre de estos notificadores (o de sí mismo). null = sin restricción.';

-- Héctor Romero y Veronna Toledo: solo "Central Tablet Diprocig"
update public.usuarios set notificadores_permitidos = array['e0505aac-3ff3-493f-b4c8-1cf948ad0f62']::uuid[]
 where id in ('98275df7-1b8d-41ee-afb2-8866fcf225b8','3ffbf400-641d-4e41-98f4-a52f58c54a8e');

-- La base lo exige (trigger de validación de la falla)
do $$
declare v_def text; v_old text := E'    select activo into v_activo from public.notificadores where id = new.notificador_id;';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname='validar_notificador_y_fecha_falla' and p.pronamespace='public'::regnamespace;
  if position(v_old in v_def) = 0 then raise exception 'no se encontró el punto de inserción'; end if;
  v_def := replace(v_def, v_old, v_old || E'\n    if exists (select 1 from public.usuarios u where u.id = new.creado_por and u.notificadores_permitidos is not null\n               and not (new.notificador_id = any (u.notificadores_permitidos))) then\n      raise exception ''Tu perfil solo puede informar a nombre de los notificadores que tienes asignados'';\n    end if;');
  execute v_def;
end $$;
