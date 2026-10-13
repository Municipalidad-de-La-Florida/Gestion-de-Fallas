-- Contratos, etapa 3: cada contratista / contratista2 ve solo las fallas de SUS contratos
-- (más las que no tienen contrato, y las que él mismo creó). Admin, ITO y observador ven todo.
-- El camión sigue viendo solo las fallas que le asignaron.
-- ANTES de ejecutar: asigna contrato a cada contratista/contratista2 (si no, solo verá fallas sin contrato).
-- Para volver atrás: ver el bloque "REVERTIR" al final.

create or replace function public.contrato_visible(p_contrato uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_contrato is null
      or coalesce(public.mi_rol(), '') not in ('contratista', 'contratista2')
      or exists (select 1 from public.usuario_contratos uc
                 where uc.usuario_id = auth.uid() and uc.contrato_id = p_contrato);
$$;
grant execute on function public.contrato_visible(uuid) to authenticated;

-- Quién verá qué (vista previa; ejecútala sola si quieres revisar antes)
-- select u.nombre, u.rol, coalesce(string_agg(c.nombre, ', '), '(sin contrato asignado)') contratos
-- from usuarios u left join usuario_contratos uc on uc.usuario_id = u.id left join contratos c on c.id = uc.contrato_id
-- where u.rol in ('contratista','contratista2','camion') group by u.id, u.nombre, u.rol order by 2, 1;

drop policy if exists fallas_select_autenticados on public.fallas;
create policy fallas_select_autenticados on public.fallas for select to authenticated
using (
  (mi_rol() <> 'camion' and (public.contrato_visible(contrato_id) or creado_por = auth.uid()))
  or asignado_camion_id = auth.uid()
);

drop policy if exists fallas_asignar_camion on public.fallas;
create policy fallas_asignar_camion on public.fallas for update to authenticated
using (mi_rol() in ('contratista', 'contratista2', 'admin') and public.contrato_visible(contrato_id))
with check (mi_rol() in ('contratista', 'contratista2', 'admin'));

drop policy if exists fallas_update_contratista_pendiente on public.fallas;
create policy fallas_update_contratista_pendiente on public.fallas for update to authenticated
using (
  (mi_rol() in ('contratista', 'contratista2') and estado <> 'reparada' and public.contrato_visible(contrato_id))
  or (mi_rol() = 'camion' and estado <> 'reparada' and asignado_camion_id = auth.uid())
)
with check (estado = 'pendiente');

-- REVERTIR (vuelve a ver todos):
-- drop policy fallas_select_autenticados on public.fallas;
-- create policy fallas_select_autenticados on public.fallas for select to authenticated using ((mi_rol() <> 'camion') or (asignado_camion_id = auth.uid()));
