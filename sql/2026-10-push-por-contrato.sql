-- Notificaciones push por contrato.
--  * Falla reparada: le llega a todos los contratistas / contratista2 del contrato de la falla
--    (menos a quien la reparó), además de al ITO/admin que la informó (como hasta ahora).
--  * Falla nueva: le llega solo a los contratistas / contratista2 de su contrato
--    (antes llegaba a todos). Si la falla no tiene contrato, se mantiene el comportamiento anterior.
-- Para volver atrás: ver el bloque REVERTIR al final.

create or replace function public.push_falla_nueva()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_dest uuid[]; v_t jsonb;
begin
  select array_agg(u.id) into v_dest from usuarios u
   where u.rol in ('contratista','contratista2')
     and u.id is distinct from coalesce(NEW.creado_por, NEW.informado_por)
     and (NEW.contrato_id is null
          or exists (select 1 from usuario_contratos uc where uc.usuario_id = u.id and uc.contrato_id = NEW.contrato_id));
  v_t := push_texto_falla(NEW.id, 'nueva');
  perform notificar_push(v_dest, v_t->>'titulo', v_t->>'cuerpo', './?falla=' || NEW.id);
  return NEW;
exception when others then raise warning 'push_falla_nueva: %', sqlerrm; return NEW;
end $function$;

create or replace function public.push_falla_reparada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_dest uuid[]; v_t jsonb; v_repara uuid;
begin
  select r.reparado_por into v_repara from reparaciones r
   where r.falla_id = NEW.id order by r.creado_en desc limit 1;
  select array_agg(distinct u.id) into v_dest from usuarios u
   where (u.id = coalesce(NEW.informado_por, NEW.creado_por) and u.rol in ('ito','ito2','admin'))
      or (NEW.contrato_id is not null
          and u.rol in ('contratista','contratista2')
          and u.id is distinct from v_repara
          and exists (select 1 from usuario_contratos uc where uc.usuario_id = u.id and uc.contrato_id = NEW.contrato_id));
  v_t := push_texto_falla(NEW.id, 'reparada');
  perform notificar_push(v_dest, v_t->>'titulo', v_t->>'cuerpo', './?falla=' || NEW.id);
  return NEW;
exception when others then raise warning 'push_falla_reparada: %', sqlerrm; return NEW;
end $function$;

-- REVERTIR (comportamiento anterior):
-- create or replace function public.push_falla_nueva() returns trigger language plpgsql security definer set search_path to 'public' as $f$
-- declare v_dest uuid[]; v_t jsonb;
-- begin
--   select array_agg(id) into v_dest from usuarios where rol in ('contratista','contratista2') and id is distinct from coalesce(NEW.creado_por, NEW.informado_por);
--   v_t := push_texto_falla(NEW.id, 'nueva');
--   perform notificar_push(v_dest, v_t->>'titulo', v_t->>'cuerpo', './?falla=' || NEW.id);
--   return NEW;
-- exception when others then raise warning 'push_falla_nueva: %', sqlerrm; return NEW;
-- end $f$;
-- create or replace function public.push_falla_reparada() returns trigger language plpgsql security definer set search_path to 'public' as $f$
-- declare v_dest uuid[]; v_t jsonb;
-- begin
--   select array_agg(id) into v_dest from usuarios where id = coalesce(NEW.informado_por, NEW.creado_por) and rol in ('ito','ito2','admin');
--   v_t := push_texto_falla(NEW.id, 'reparada');
--   perform notificar_push(v_dest, v_t->>'titulo', v_t->>'cuerpo', './?falla=' || NEW.id);
--   return NEW;
-- exception when others then raise warning 'push_falla_reparada: %', sqlerrm; return NEW;
-- end $f$;
