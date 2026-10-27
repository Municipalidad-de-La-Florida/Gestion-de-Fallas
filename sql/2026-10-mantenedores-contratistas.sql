-- Contratistas por contrato Y/O por mantenedor (después de 2026-10-mantenedores-etapa1.sql).
-- Un contratista ve (y atiende) una falla si su contrato está en sus contratos O si el mantenedor de la falla
-- está en sus mantenedores. Quien hoy tiene solo contratos sigue viendo exactamente lo mismo.
-- Las fallas sin contrato ni mantenedor solo las ven admin, ITO y observador (como hasta ahora). Se puede repetir.
begin;

-- 1) Mantenedores por usuario (lista de nombres que elige el admin)
create table if not exists public.usuario_mantenedores (
  usuario_id    uuid not null references public.usuarios(id) on delete cascade,
  mantenedor_id uuid not null references public.mantenedores(id) on delete cascade,
  primary key (usuario_id, mantenedor_id)
);
alter table public.usuario_mantenedores enable row level security;
drop policy if exists usuario_mantenedores_select on public.usuario_mantenedores;
create policy usuario_mantenedores_select on public.usuario_mantenedores for select to authenticated
  using (usuario_id = (select auth.uid()) or (select public.mi_rol()) = 'admin');
drop policy if exists usuario_mantenedores_admin on public.usuario_mantenedores;
create policy usuario_mantenedores_admin on public.usuario_mantenedores for all to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');

create or replace function public.set_mantenedores_usuario(p_usuario uuid, p_mantenedores uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tiene_permiso('admin_usuarios') then
    raise exception 'Solo el administrador puede asignar mantenedores.';
  end if;
  delete from public.usuario_mantenedores
   where usuario_id = p_usuario
     and (p_mantenedores is null or mantenedor_id <> all(p_mantenedores));
  insert into public.usuario_mantenedores (usuario_id, mantenedor_id)
    select p_usuario, m.id from public.mantenedores m
    where p_mantenedores is not null and m.id = any(p_mantenedores)
  on conflict do nothing;
end $$;
revoke all on function public.set_mantenedores_usuario(uuid, uuid[]) from public, anon;
grant execute on function public.set_mantenedores_usuario(uuid, uuid[]) to authenticated;

-- 2) Regla de visibilidad: contrato O mantenedor (los roles que no son contratista ven todo, como antes)
create or replace function public.falla_visible(p_contrato uuid, p_mantenedor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol(), '') not in ('contratista', 'contratista2', 'contratista3')
      or (p_contrato is not null and exists (select 1 from public.usuario_contratos uc
                                              where uc.usuario_id = auth.uid() and uc.contrato_id = p_contrato))
      or (p_mantenedor is not null and exists (select 1 from public.usuario_mantenedores um
                                                where um.usuario_id = auth.uid() and um.mantenedor_id = p_mantenedor));
$$;
revoke all on function public.falla_visible(uuid, uuid) from public, anon;
grant execute on function public.falla_visible(uuid, uuid) to authenticated;

create or replace function public.alcance_falla(p_contrato uuid, p_camion uuid, p_mantenedor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.mi_rol() = 'camion' then p_camion = auth.uid()
    when public.mi_rol() in ('contratista', 'contratista2', 'contratista3') then public.falla_visible(p_contrato, p_mantenedor)
    else true end;
$$;
revoke all on function public.alcance_falla(uuid, uuid, uuid) from public, anon;
grant execute on function public.alcance_falla(uuid, uuid, uuid) to authenticated;

-- 3) Políticas de la tabla fallas (solo cambia la condición de contrato: se agrega la de mantenedor)
alter policy fallas_select_autenticados on public.fallas using (
  (
    ((select public.mi_rol()) <> 'camion')
    and (
      coalesce((select public.mi_rol()), '') <> all (array['contratista', 'contratista2', 'contratista3'])
      or contrato_id in (select uc.contrato_id from public.usuario_contratos uc where uc.usuario_id = (select auth.uid()))
      or mantenedor_id in (select um.mantenedor_id from public.usuario_mantenedores um where um.usuario_id = (select auth.uid()))
      or creado_por = (select auth.uid())
    )
  )
  or asignado_camion_id = (select auth.uid())
);
alter policy fallas_asignar_camion on public.fallas using (
  (select public.tiene_permiso('reparacion_asignar_camion')) and public.falla_visible(contrato_id, mantenedor_id)
);
alter policy fallas_update_contratista_pendiente on public.fallas using (
  (select public.tiene_permiso('reparacion_cerrar')) and estado <> 'reparada'
  and public.alcance_falla(contrato_id, asignado_camion_id, mantenedor_id)
);

-- 4) Cuadrillas: un contratista ve los camiones que comparten algún contrato o mantenedor con él
create or replace function public.listar_camiones_contrato()
returns table(id uuid, nombre text) language sql stable security definer set search_path = public as $$
  select u.id, u.nombre from public.usuarios u
  where u.rol = 'camion'
    and (public.mi_rol() = 'admin'
         or exists (select 1 from public.usuario_contratos a
                    join public.usuario_contratos b on b.contrato_id = a.contrato_id
                    where a.usuario_id = u.id and b.usuario_id = auth.uid())
         or exists (select 1 from public.usuario_mantenedores a
                    join public.usuario_mantenedores b on b.mantenedor_id = a.mantenedor_id
                    where a.usuario_id = u.id and b.usuario_id = auth.uid()))
  order by u.nombre;
$$;

create or replace function public.asignar_camion_inspeccion(p_inspeccion uuid, p_camion uuid, p_sobrescribir boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.tiene_permiso('inspeccion_asignar_lote') then
    raise exception 'Solo un Contratista3 o Admin puede asignar una inspección completa';
  end if;
  if not exists (select 1 from public.usuarios where id = p_camion and rol = 'camion') then
    raise exception 'El destino debe ser un usuario de rol camión';
  end if;
  update public.fallas f
     set asignado_camion_id = p_camion, asignado_por_id = auth.uid()
   where f.inspeccion_id = p_inspeccion
     and f.cascada = false
     and f.estado <> 'reparada'
     and public.falla_visible(f.contrato_id, f.mantenedor_id)
     and (f.contrato_id is not null or f.mantenedor_id is not null)
     and (exists (select 1 from public.usuario_contratos uc where uc.usuario_id = p_camion and uc.contrato_id = f.contrato_id)
          or exists (select 1 from public.usuario_mantenedores um where um.usuario_id = p_camion and um.mantenedor_id = f.mantenedor_id))
     and (p_sobrescribir or f.asignado_camion_id is null);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 5) Avisos push: le llegan a quien ve la falla (por contrato o por mantenedor).
--    Una falla sin contrato ni mantenedor avisa solo a admin, ITO y observador (no a contratistas ni camiones).
create or replace function public.push_falla_nueva()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dest uuid[]; v_t jsonb;
begin
  if coalesce(current_setting('app.aporte', true), '') = '1' then return NEW; end if;
  select array_agg(u.id) into v_dest from usuarios u
   where public.usuario_tiene_permiso(u.id, 'push_falla_informada')
     and u.id is distinct from coalesce(NEW.creado_por, NEW.informado_por)
     and ((NEW.contrato_id is null and NEW.mantenedor_id is null
           and u.rol not in ('contratista', 'contratista2', 'contratista3', 'camion'))
          or (NEW.contrato_id is not null and exists (select 1 from usuario_contratos uc where uc.usuario_id = u.id and uc.contrato_id = NEW.contrato_id))
          or (NEW.mantenedor_id is not null and exists (select 1 from usuario_mantenedores um where um.usuario_id = u.id and um.mantenedor_id = NEW.mantenedor_id)));
  v_t := push_texto_falla(NEW.id, 'nueva');
  perform notificar_push(v_dest, v_t->>'titulo', v_t->>'cuerpo', './?falla=' || NEW.id);
  return NEW;
exception when others then raise warning 'push_falla_nueva: %', sqlerrm; return NEW;
end $$;

create or replace function public.push_falla_reparada()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dest uuid[]; v_t jsonb; v_repara uuid;
begin
  if coalesce(current_setting('app.aporte', true), '') = '1' then return NEW; end if;
  select r.reparado_por into v_repara from reparaciones r
   where r.falla_id = NEW.id order by r.creado_en desc limit 1;
  select array_agg(distinct u.id) into v_dest from usuarios u
   where (u.id = coalesce(NEW.informado_por, NEW.creado_por) and coalesce(public.usuario_tiene_permiso(u.id, 'push_falla_reparada'), false))
      or ((NEW.contrato_id is not null or NEW.mantenedor_id is not null)
          and public.usuario_tiene_permiso(u.id, 'push_falla_reparada')
          and u.id is distinct from v_repara
          and ((NEW.contrato_id is not null and exists (select 1 from usuario_contratos uc where uc.usuario_id = u.id and uc.contrato_id = NEW.contrato_id))
               or (NEW.mantenedor_id is not null and exists (select 1 from usuario_mantenedores um where um.usuario_id = u.id and um.mantenedor_id = NEW.mantenedor_id))));
  v_t := push_texto_falla(NEW.id, 'reparada');
  perform notificar_push(v_dest, v_t->>'titulo', v_t->>'cuerpo', './?falla=' || NEW.id);
  return NEW;
exception when others then raise warning 'push_falla_reparada: %', sqlerrm; return NEW;
end $$;

commit;
