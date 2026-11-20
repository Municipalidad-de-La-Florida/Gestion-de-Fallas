-- Optimización (2026-11-20). Ya aplicado en Supabase mediante migraciones.
-- 1) fallas_geojson: mi_rol() se evalúa una sola vez (initplan) y _falla_cerrada_900_activa(f.id) pasa al final del OR,
--    así solo se llama cuando las otras condiciones no bastan. Resultado idéntico (comparado por rol: admin, camión,
--    contratista 1/2/3, ito, ito2, observador) y ~40 % más rápida. Para reaplicarla: tomar la definición vigente y reemplazar
--      'public.mi_rol()'  ->  '(select public.mi_rol())'
--      quitar 'public._falla_cerrada_900_activa(f.id) or ' y agregar ' or public._falla_cerrada_900_activa(f.id)' al final del grupo OR.
-- 2) Permisos: se quita EXECUTE a PUBLIC/anon (authenticated lo conserva por concesión propia).
revoke execute on function public.anular_reparacion(uuid,text,text) from public, anon;
revoke execute on function public.editar_motivo_pendiente(uuid,text) from public, anon;
revoke execute on function public._reparacion_marca_corte() from public, anon;
-- 3) RLS: auth.uid() se evalúa una vez por consulta
alter policy fallas_delete_propia on public.fallas using ((creado_por = (select auth.uid())) and (estado <> 'reparada'::text) and (fecha_falla_real > (now() - interval '00:15:00')));
alter policy fallas_fotos_select on public.fallas_fotos using (exists (select 1 from public.usuarios u where u.id = (select auth.uid())));
alter policy fallas_foto_reporte_select on public.fallas_foto_reporte using (exists (select 1 from public.usuarios u where u.id = (select auth.uid())));
-- 4) search_path fijo en funciones auxiliares y un índice parcial
alter function public._req_codigo(integer) set search_path = public;
alter function public._req_tipo_label(text) set search_path = public;
alter function public.dias_atraso_falla(text, timestamptz) set search_path = public;
alter function public.num_loteo(text) set search_path = public;
alter function public.suministro_en_poligono(double precision, double precision, jsonb) set search_path = public;
create index if not exists fallas_maestro_idx on public.fallas (maestro_id) where maestro_id is not null;
-- 5) Las tablas de respaldo se movieron al esquema "archivo" (sin acceso por la API): no se borraron datos.
create schema if not exists archivo;
revoke all on schema archivo from public, anon, authenticated;
-- alter table public.respaldo_limpieza_20260921 set schema archivo;
-- alter table public.respaldo_desasignacion_enelx_20261021 set schema archivo;
