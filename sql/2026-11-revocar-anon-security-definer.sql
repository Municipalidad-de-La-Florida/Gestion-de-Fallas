-- Quita al rol anon (usuarios sin sesión) el permiso de ejecutar funciones
-- SECURITY DEFINER de public. La app siempre las llama con sesión iniciada
-- (rol authenticated), así que esto no cambia nada para los usuarios.
-- Los triggers siguen funcionando: Postgres no revisa EXECUTE al dispararlos.
-- No se tocan las funciones de PostGIS (st_estimatedextent).
-- Se puede ejecutar más de una vez.

-- Funciones que se llaman por RPC
revoke execute on function public._reparacion_autorizada(uuid) from public, anon;
revoke execute on function public._validar_inspeccion_ito(date, uuid) from public, anon;
revoke execute on function public.activar_operativo(date, text) from public, anon;
revoke execute on function public.analisis_cierres(date, date, text, boolean, uuid[], uuid, uuid[]) from public, anon;
revoke execute on function public.analisis_fallas(date, date, text, boolean, uuid[], uuid, uuid[]) from public, anon;
revoke execute on function public.analisis_puntos_afectados(date, date, text, boolean, uuid[], uuid, uuid[]) from public, anon;
revoke execute on function public.anular_reparacion(uuid, text) from public, anon;
revoke execute on function public.asignar_camion_inspeccion(uuid, uuid, boolean) from public, anon;
revoke execute on function public.codigos_frecuentes(integer) from public, anon;
revoke execute on function public.contrato_visible(uuid) from public, anon;
revoke execute on function public.editar_reparacion(uuid, jsonb) from public, anon;
revoke execute on function public.listar_camiones_contrato() from public, anon;
revoke execute on function public.quitar_foto_reparacion(uuid) from public, anon;
revoke execute on function public.quitar_operativo(date) from public, anon;
revoke execute on function public.reparacion_estado(uuid) from public, anon;

-- Funciones de trigger
revoke execute on function public._cuaderno_limpiar_al_informar() from public, anon;
revoke execute on function public.exigir_foto_reparacion() from public, anon;
revoke execute on function public.fallas_set_luminaria() from public, anon;
revoke execute on function public.fn_derivar_contrato_mantenedor() from public, anon;
revoke execute on function public.fn_masivo_ex_clever() from public, anon;
revoke execute on function public.fn_recalcular_tras_equivalencias() from public, anon;
revoke execute on function public.propagar_contrato_cascada() from public, anon;
revoke execute on function public.registrar_asignacion_historial() from public, anon;
revoke execute on function public.usuarios_sync_perfil() from public, anon;
revoke execute on function public.validar_inspeccion_en_falla() from public, anon;

-- Asegura que los usuarios con sesión mantengan el acceso a las RPC
grant execute on function public._validar_inspeccion_ito(date, uuid) to authenticated;
grant execute on function public.activar_operativo(date, text) to authenticated;
grant execute on function public.analisis_cierres(date, date, text, boolean, uuid[], uuid, uuid[]) to authenticated;
grant execute on function public.analisis_fallas(date, date, text, boolean, uuid[], uuid, uuid[]) to authenticated;
grant execute on function public.analisis_puntos_afectados(date, date, text, boolean, uuid[], uuid, uuid[]) to authenticated;
grant execute on function public.anular_reparacion(uuid, text) to authenticated;
grant execute on function public.asignar_camion_inspeccion(uuid, uuid, boolean) to authenticated;
grant execute on function public.codigos_frecuentes(integer) to authenticated;
grant execute on function public.contrato_visible(uuid) to authenticated;
grant execute on function public.editar_reparacion(uuid, jsonb) to authenticated;
grant execute on function public.listar_camiones_contrato() to authenticated;
grant execute on function public.quitar_foto_reparacion(uuid) to authenticated;
grant execute on function public.quitar_operativo(date) to authenticated;
grant execute on function public.reparacion_estado(uuid) to authenticated;
grant execute on function public._reparacion_autorizada(uuid) to authenticated;
