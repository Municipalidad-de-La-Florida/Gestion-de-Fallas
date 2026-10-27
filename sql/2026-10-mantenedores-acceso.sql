-- Acceso por contrato O por mantenedor (después de 2026-10-mantenedores-contratistas.sql).
--  - Perfil por CONTRATO (ej. Elecnor): ve todas las fallas del contrato y asigna a los camiones de los mantenedores que lo atienden.
--  - Subcontratista por MANTENEDOR (ej. Sinec): ve lo de su mantenedor en cualquier contrato; el contrato "viene de la falla".
--  - Camión por MANTENEDOR: no necesita contrato; el contrato se deduce de la tabla de equivalencias.
-- Quien hoy tiene contratos sigue igual. Se puede repetir.
begin;

-- 1) Contratos "efectivos" del usuario: los suyos + los que atiende alguno de sus mantenedores
create or replace function public.mis_contratos_efectivos()
returns setof uuid language sql stable security definer set search_path = public as $$
  select uc.contrato_id from public.usuario_contratos uc where uc.usuario_id = auth.uid()
  union
  select e.contrato_id from public.usuario_mantenedores um
    join public.mantenimiento_equivalencias e on e.mantenedor_id = um.mantenedor_id and e.contrato_id is not null
   where um.usuario_id = auth.uid();
$$;
revoke all on function public.mis_contratos_efectivos() from public, anon;
grant execute on function public.mis_contratos_efectivos() to authenticated;

-- 2) Cuadrillas que ve un contratista: las que comparten contrato (como antes), las de su mantenedor
--    y las de los mantenedores que atienden sus contratos
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
                    where a.usuario_id = u.id and b.usuario_id = auth.uid())
         or exists (select 1 from public.usuario_mantenedores a
                    join public.mantenimiento_equivalencias e on e.mantenedor_id = a.mantenedor_id
                    join public.usuario_contratos b on b.contrato_id = e.contrato_id
                    where a.usuario_id = u.id and b.usuario_id = auth.uid()))
  order by u.nombre;
$$;

-- 3) Asignar una inspección completa: el camión sirve si es del mantenedor de la falla o del contrato (antiguo)
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

-- 4) Aportes: el camión puede aportar en los contratos que atiende su mantenedor, y se avisa también a los subcontratistas
do $$
declare v_def text; v_nuevo text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_aporte';
  v_def := pg_get_functiondef(v_oid);
  if v_def like '%mis_contratos_efectivos%' then return; end if;
  v_nuevo := replace(v_def,
    'not exists (select 1 from public.usuario_contratos where usuario_id = v_uid and contrato_id = p_contrato_id)',
    'not exists (select 1 from public.mis_contratos_efectivos() c where c = p_contrato_id)');
  v_nuevo := replace(v_nuevo,
    'and exists (select 1 from public.usuario_contratos uc where uc.usuario_id = u.id and uc.contrato_id = p_contrato_id);',
    'and (exists (select 1 from public.usuario_contratos uc where uc.usuario_id = u.id and uc.contrato_id = p_contrato_id)
          or exists (select 1 from public.usuario_mantenedores um join public.mantenimiento_equivalencias e on e.mantenedor_id = um.mantenedor_id
                      where um.usuario_id = u.id and e.contrato_id = p_contrato_id));');
  if v_nuevo = v_def or v_nuevo not like '%mis_contratos_efectivos%' or v_nuevo not like '%usuario_mantenedores um join%' then
    raise exception 'No se pudo actualizar registrar_aporte: su definición cambió';
  end if;
  execute v_nuevo;
end $$;

-- 5) Maestros (por contrato): también los ve y usa quien llega por mantenedor
alter policy maestros_select on public.maestros using (
  (select public.mi_rol()) = any (array['admin', 'observador'])
  or contrato_id in (select public.mis_contratos_efectivos())
);
alter policy maestros_insert on public.maestros with check (
  (select public.tiene_permiso('maestros'))
  and ((select public.mi_rol()) <> all (array['contratista', 'contratista2', 'contratista3'])
       or contrato_id in (select public.mis_contratos_efectivos()))
);
alter policy maestros_update on public.maestros
  using ((select public.tiene_permiso('maestros'))
         and ((select public.mi_rol()) <> all (array['contratista', 'contratista2', 'contratista3'])
              or contrato_id in (select public.mis_contratos_efectivos())))
  with check ((select public.tiene_permiso('maestros'))
         and ((select public.mi_rol()) <> all (array['contratista', 'contratista2', 'contratista3'])
              or contrato_id in (select public.mis_contratos_efectivos())));

commit;
