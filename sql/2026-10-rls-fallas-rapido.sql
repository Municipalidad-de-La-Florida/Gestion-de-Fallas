-- Acelera las lecturas de public.fallas (mapa y listados) sin cambiar quién ve qué.
--
-- Problema: la política de SELECT llamaba mi_rol() y contrato_visible() por cada fila
-- (son funciones SECURITY DEFINER que consultan tablas). Con ~3.600 fallas eso eran ~650 ms
-- solo en la política, y se repetía en cada carga del mapa (fallas_geojson: 1,9 s en promedio).
-- Solución: calcular el rol y los contratos del usuario UNA vez por consulta (InitPlan).
-- Medido: el mismo filtro pasó de ~680 ms a ~3 ms.
--
-- Equivalencia con la política anterior:
--   ((mi_rol() <> 'camion') AND (contrato_visible(contrato_id) OR creado_por = auth.uid()))
--   OR asignado_camion_id = auth.uid()
-- contrato_visible(c) = coalesce(mi_rol(),'') NOT IN (contratistas) OR el usuario tiene el contrato c
-- (usuario_contratos permite a cada usuario ver sus propias filas, por lo que la subconsulta es equivalente).
--
-- Para volver atrás: ver el bloque ROLLBACK al final.

drop policy if exists fallas_select_autenticados on public.fallas;
create policy fallas_select_autenticados on public.fallas
  for select to authenticated
  using (
    (
      (select public.mi_rol()) <> 'camion'
      and (
        coalesce((select public.mi_rol()), '') not in ('contratista', 'contratista2', 'contratista3')
        or contrato_id in (select uc.contrato_id from public.usuario_contratos uc where uc.usuario_id = (select auth.uid()))
        or creado_por = (select auth.uid())
      )
    )
    or asignado_camion_id = (select auth.uid())
  );

-- ROLLBACK (política original):
-- drop policy if exists fallas_select_autenticados on public.fallas;
-- create policy fallas_select_autenticados on public.fallas
--   for select to authenticated
--   using (((mi_rol() <> 'camion'::text) and (contrato_visible(contrato_id) or (creado_por = auth.uid()))) or (asignado_camion_id = auth.uid()));
