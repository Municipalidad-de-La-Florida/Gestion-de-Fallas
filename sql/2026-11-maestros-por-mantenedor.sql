-- Los maestros pertenecen a un MANTENEDOR (Sinec, Clever), no a un contrato.
-- Un aporte muestra los maestros de los mantenedores del usuario (camión). Compatible con la app anterior (sigue aceptando el criterio por contrato).
alter table public.maestros add column if not exists mantenedor_id uuid references public.mantenedores(id);
alter table public.maestros alter column contrato_id drop not null;
update public.maestros set mantenedor_id = (select id from public.mantenedores where nombre = 'Sinec') where mantenedor_id is null;
create unique index if not exists maestros_mantenedor_nombre_uq on public.maestros (mantenedor_id, lower(btrim(nombre))) where mantenedor_id is not null;

-- Mantenedores del usuario (todos los activos si es admin)
create or replace function public.mis_mantenedores_lista()
returns table(id uuid, nombre text) language sql stable security definer set search_path to 'public'
as $f$
  select m.id, m.nombre from public.mantenedores m
   where m.activo and (public.mi_rol() = 'admin' or exists (select 1 from public.usuario_mantenedores um where um.mantenedor_id = m.id and um.usuario_id = auth.uid()))
   order by m.nombre;
$f$;
revoke all on function public.mis_mantenedores_lista() from public, anon;
grant execute on function public.mis_mantenedores_lista() to authenticated;

create or replace function public.mis_mantenedores_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $f$ select mantenedor_id from public.usuario_mantenedores where usuario_id = auth.uid(); $f$;
revoke all on function public.mis_mantenedores_ids() from public, anon;
grant execute on function public.mis_mantenedores_ids() to authenticated;

drop policy if exists maestros_select on public.maestros;
create policy maestros_select on public.maestros for select using (
  ((select mi_rol()) = any (array['admin','observador']))
  or contrato_id in (select mis_contratos_efectivos())
  or mantenedor_id in (select mis_mantenedores_ids()));
drop policy if exists maestros_insert on public.maestros;
create policy maestros_insert on public.maestros for insert with check (
  (select tiene_permiso('maestros'))
  and (((select mi_rol()) <> all (array['contratista','contratista2','contratista3']))
       or contrato_id in (select mis_contratos_efectivos())
       or mantenedor_id in (select mis_mantenedores_ids())));
drop policy if exists maestros_update on public.maestros;
create policy maestros_update on public.maestros for update using (
  (select tiene_permiso('maestros'))
  and (((select mi_rol()) <> all (array['contratista','contratista2','contratista3']))
       or contrato_id in (select mis_contratos_efectivos())
       or mantenedor_id in (select mis_mantenedores_ids())))
 with check (
  (select tiene_permiso('maestros'))
  and (((select mi_rol()) <> all (array['contratista','contratista2','contratista3']))
       or contrato_id in (select mis_contratos_efectivos())
       or mantenedor_id in (select mis_mantenedores_ids())));

-- registrar_aporte: el maestro vale si es de un mantenedor del usuario (o, como antes, del mismo contrato)
do $$
declare d text;
  viejo text := 'if v_maestro is null or v_maestro_contrato is distinct from p_contrato_id or not v_maestro_activo then';
  nuevo text := 'if v_maestro is null or not v_maestro_activo or not (v_maestro_contrato is not distinct from p_contrato_id or exists (select 1 from public.maestros mm join public.usuario_mantenedores um on um.mantenedor_id = mm.mantenedor_id where mm.id = p_maestro_id and um.usuario_id = v_uid)) then';
begin
  d := pg_get_functiondef('public.registrar_aporte(uuid,uuid,text,integer,text,text,text,uuid,text,jsonb)'::regprocedure);
  if position('usuario_mantenedores um on um.mantenedor_id = mm.mantenedor_id' in d) > 0 then raise notice 'Ya está aplicado.'; return; end if;
  if position(viejo in d) = 0 then raise exception 'No se encontró la validación del maestro'; end if;
  execute replace(d, viejo, nuevo);
end $$;
