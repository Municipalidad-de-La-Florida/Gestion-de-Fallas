-- PERFILES Y PERMISOS · ETAPA FINAL: la base obedece la grilla de Configuración → Perfiles y permisos.
--
-- Hasta ahora las reglas de seguridad de la base miraban el rol base (admin, ito, contratista, camion…).
-- Desde aquí, QUÉ PUEDE HACER una persona lo decide su perfil (la grilla); el rol base solo fija el ALCANCE
-- (por ejemplo: un contratista ve solo los contratos que tiene asignados, un camión solo las fallas que le asignaron).
--
-- Con la grilla de fábrica nada cambia para nadie (cada función quedó sembrada igual que las reglas anteriores).
-- Diferencias intencionales:
--   · Push: ahora salen según la grilla (push_falla_informada / _asignada / _reparada). Contratista 3 queda incluido.
--   · Fiscalización: basta tener la función (perfil o casilla individual); ya no exige además rol admin/ito/ito2.
--
-- Es seguro ejecutarlo más de una vez. Si algo no coincide con lo esperado, se detiene SIN cambiar nada.
-- Requiere haber ejecutado antes sql/2026-10-perfiles-permisos-etapa1.sql.

-- 1) Ayudantes -----------------------------------------------------------------------------------------------------
-- ¿Tiene esa función un usuario cualquiera? (perfil + casilla individual en las 6 funciones «por usuario»)
create or replace function public.usuario_tiene_permiso(p_usuario uuid, p_funcion text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare u public.usuarios%rowtype; v_ok boolean;
begin
  if p_usuario is null then return false; end if;
  select * into u from public.usuarios where id = p_usuario;
  if not found then return false; end if;
  select pf.habilitado into v_ok from public.perfil_funciones pf where pf.perfil = u.perfil and pf.funcion = p_funcion;
  if coalesce(v_ok, false) then return true; end if;
  return coalesce(case p_funcion
    when 'notificador_externo'    then u.notificador_externo_habilitado
    when 'pasar_a_masivo'         then u.puede_pasar_a_masivo
    when 'foto_obligatoria'       then u.foto_obligatoria
    when 'rendimiento_cuadrillas' then u.ver_cuadrillas
    when 'fiscalizacion'          then u.ver_fiscalizacion
    when 'ubicacion_camiones'     then u.ver_ubicacion
    else false end, false);
end;
$function$;
revoke all on function public.usuario_tiene_permiso(uuid, text) from public, anon;
grant execute on function public.usuario_tiene_permiso(uuid, text) to authenticated;

-- La función de siempre (para quien tiene la sesión abierta) ahora usa la de arriba.
create or replace function public.tiene_permiso(p_funcion text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select public.usuario_tiene_permiso(auth.uid(), p_funcion);
$function$;
grant execute on function public.tiene_permiso(text) to authenticated;

-- Alcance de una falla según el rol base: camión = solo las que le asignaron; contratista = solo sus contratos; el resto, todas.
create or replace function public.alcance_falla(p_contrato uuid, p_camion uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select case
    when public.mi_rol() = 'camion' then p_camion = auth.uid()
    when public.mi_rol() in ('contratista', 'contratista2', 'contratista3') then public.contrato_visible(p_contrato)
    else true end;
$function$;
revoke all on function public.alcance_falla(uuid, uuid) from public, anon;
grant execute on function public.alcance_falla(uuid, uuid) to authenticated;

-- 2) Funciones: se cambia SOLO la condición de permiso (cada texto se busca tal cual está hoy) ------------------------
do $do$
declare r record; v_oid oid; v_n int; v_def text;
begin
  for r in select * from (values
    ('activar_operativo', $q$if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador puede activar un operativo'$q$, $q$if not public.tiene_permiso('operativo_activar') then raise exception 'No tienes permiso para activar un operativo'$q$, $q$if not public.tiene_permiso('operativo_activar') then raise exception 'No tienes permiso para activar un operativo'$q$),
    ('quitar_operativo', $q$if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador puede quitar un operativo'$q$, $q$if not public.tiene_permiso('operativo_activar') then raise exception 'No tienes permiso para quitar un operativo'$q$, $q$if not public.tiene_permiso('operativo_activar') then raise exception 'No tienes permiso para quitar un operativo'$q$),
    ('admin_eliminar_inspeccion', $q$if v_rol is distinct from 'admin' then raise exception 'Solo el administrador puede editar o eliminar inspecciones'$q$, $q$if not public.tiene_permiso('inspeccion_editar') then raise exception 'No tienes permiso para editar o eliminar inspecciones'$q$, $q$if not public.tiene_permiso('inspeccion_editar') then raise exception 'No tienes permiso para editar o eliminar inspecciones'$q$),
    ('analisis_cierres', $q$u.rol in ('admin','ito','ito2')$q$, $q$(public.tiene_permiso('analisis') or public.tiene_permiso('estadisticas'))$q$, $q$(public.tiene_permiso('analisis') or public.tiene_permiso('estadisticas'))$q$),
    ('analisis_fallas', $q$u.rol in ('admin','ito','ito2')$q$, $q$(public.tiene_permiso('analisis') or public.tiene_permiso('estadisticas'))$q$, $q$(public.tiene_permiso('analisis') or public.tiene_permiso('estadisticas'))$q$),
    ('analisis_puntos_afectados', $q$u.rol in ('admin','ito','ito2')$q$, $q$(public.tiene_permiso('analisis') or public.tiene_permiso('estadisticas'))$q$, $q$(public.tiene_permiso('analisis') or public.tiene_permiso('estadisticas'))$q$),
    ('operativo_detalle', $q$u.rol in ('admin','ito','ito2')$q$, $q$public.tiene_permiso('estadisticas_inspecciones')$q$, $q$public.tiene_permiso('estadisticas_inspecciones')$q$),
    ('operativos_periodo', $q$u.rol in ('admin','ito','ito2')$q$, $q$public.tiene_permiso('estadisticas_inspecciones')$q$, $q$public.tiene_permiso('estadisticas_inspecciones')$q$),
    ('asignar_camion_inspeccion', $q$coalesce(public.mi_rol(), '') not in ('contratista3', 'admin')$q$, $q$not public.tiene_permiso('inspeccion_asignar_lote')$q$, $q$not public.tiene_permiso('inspeccion_asignar_lote')$q$),
    ('asignar_fallas_a_inspeccion', $q$if public.mi_rol() is distinct from 'admin' then$q$, $q$if not public.tiene_permiso('inspeccion_editar') then$q$, $q$if not public.tiene_permiso('inspeccion_editar') then$q$),
    ('fallas_sueltas_ito', $q$if public.mi_rol() is distinct from 'admin' then$q$, $q$if not public.tiene_permiso('inspeccion_editar') then$q$, $q$if not public.tiene_permiso('inspeccion_editar') then$q$),
    ('editar_falla', $q$if v_rol = 'admin' then$q$, $q$if public.tiene_permiso('falla_editar_cualquiera') then$q$, $q$if public.tiene_permiso('falla_editar_cualquiera') then$q$),
    ('editar_falla', $q$elsif v_rol in ('ito','ito2','contratista2', 'contratista3')$q$, $q$elsif public.tiene_permiso('falla_editar_propia')$q$, $q$elsif public.tiene_permiso('falla_editar_propia')$q$),
    ('editar_falla', $q$if not coalesce(v_hab, false) then$q$, $q$if not public.tiene_permiso('notificador_externo') then$q$, $q$if not public.tiene_permiso('notificador_externo') then$q$),
    ('exigir_foto_reparacion', $q$coalesce((select foto_obligatoria from usuarios where id = new.reparado_por), false)$q$, $q$public.usuario_tiene_permiso(new.reparado_por, 'foto_obligatoria')$q$, $q$public.usuario_tiene_permiso(new.reparado_por, 'foto_obligatoria')$q$),
    ('quitar_foto_reparacion', $q$coalesce((select foto_obligatoria from public.usuarios where id = auth.uid()), false)$q$, $q$public.tiene_permiso('foto_obligatoria')$q$, $q$public.tiene_permiso('foto_obligatoria')$q$),
    ('registrar_reparacion', $q$coalesce((select foto_obligatoria from public.usuarios where id = v_uid), false)$q$, $q$public.usuario_tiene_permiso(v_uid, 'foto_obligatoria')$q$, $q$public.usuario_tiene_permiso(v_uid, 'foto_obligatoria')$q$),
    ('fiscalizacion_fallas', $q$if public.mi_rol() not in ('admin','ito','ito2')
     or not coalesce((select ver_fiscalizacion from public.usuarios where id = auth.uid()), false) then$q$, $q$if not public.tiene_permiso('fiscalizacion') then$q$, $q$tiene_permiso('fiscalizacion')$q$),
    ('fusionar_notificadores', $q$if coalesce(public.mi_rol(), '') <> 'admin' then$q$, $q$if not public.tiene_permiso('admin_catalogos') then$q$, $q$if not public.tiene_permiso('admin_catalogos') then$q$),
    ('vincular_notificador_usuario', $q$if coalesce(public.mi_rol(),'') <> 'admin' then raise exception 'Solo el admin puede vincular notificadores'$q$, $q$if not public.tiene_permiso('admin_catalogos') then raise exception 'No tienes permiso para vincular notificadores'$q$, $q$if not public.tiene_permiso('admin_catalogos') then raise exception 'No tienes permiso para vincular notificadores'$q$),
    ('notificador_de_usuario', $q$exists (select 1 from public.usuarios u where u.id = auth.uid() and u.notificador_externo_habilitado)$q$, $q$public.tiene_permiso('notificador_externo')$q$, $q$public.tiene_permiso('notificador_externo')$q$),
    ('usuarios_notificables', $q$exists (select 1 from public.usuarios u where u.id = auth.uid() and u.notificador_externo_habilitado)$q$, $q$public.tiene_permiso('notificador_externo')$q$, $q$public.tiene_permiso('notificador_externo')$q$),
    ('obtener_o_crear_notificador', $q$if not exists (select 1 from public.usuarios
                 where id = auth.uid() and notificador_externo_habilitado) then$q$, $q$if not public.tiene_permiso('notificador_externo') then$q$, $q$if not public.tiene_permiso('notificador_externo') then$q$),
    ('pasar_a_masivo', $q$select u.puede_pasar_a_masivo into v_ok from public.usuarios u where u.id = auth.uid();$q$, $q$v_ok := public.tiene_permiso('pasar_a_masivo');$q$, $q$v_ok := public.tiene_permiso('pasar_a_masivo');$q$),
    ('registrar_aporte', $q$if v_rol is null or v_rol not in ('camion', 'admin') then$q$, $q$if v_rol is null or not (public.tiene_permiso('aporte_registrar') or v_rol = 'admin') then$q$, $q$if v_rol is null or not (public.tiene_permiso('aporte_registrar') or v_rol = 'admin') then$q$),
    ('registrar_foto_falla', $q$if v_rol is null or v_rol not in ('admin','contratista','contratista2', 'contratista3','camion') then$q$, $q$if v_rol is null or not public.tiene_permiso('reparacion_cerrar') then$q$, $q$if v_rol is null or not public.tiene_permiso('reparacion_cerrar') then$q$),
    ('rendimiento_cuadrillas', $q$if not coalesce((select ver_cuadrillas from public.usuarios where id = auth.uid()), false) then$q$, $q$if not public.tiene_permiso('rendimiento_cuadrillas') then$q$, $q$if not public.tiene_permiso('rendimiento_cuadrillas') then$q$),
    ('rendimiento_cuadrillas_v2', $q$if not coalesce((select ver_cuadrillas from public.usuarios where id = auth.uid()), false) then$q$, $q$if not public.tiene_permiso('rendimiento_cuadrillas') then$q$, $q$if not public.tiene_permiso('rendimiento_cuadrillas') then$q$),
    ('reparacion_estado', $q$elsif v_rol in ('contratista','contratista2','contratista3','camion') and r.reparado_por = auth.uid()$q$, $q$elsif public.tiene_permiso('reparacion_editar_propia') and r.reparado_por = auth.uid()$q$, $q$elsif public.tiene_permiso('reparacion_editar_propia') and r.reparado_por = auth.uid()$q$),
    ('reportar_ubicacion', $q$public.mi_rol() <> 'camion' then return; end if;$q$, $q$not public.tiene_permiso('ubicacion_gps_compartir') then return; end if;$q$, $q$not public.tiene_permiso('ubicacion_gps_compartir') then return; end if;$q$),
    ('proteger_contrato_falla', $q$and public.mi_rol() in ('contratista', 'camion', 'observador') then$q$, $q$and auth.uid() is not null and not public.tiene_permiso('falla_cambiar_contrato') then$q$, $q$and auth.uid() is not null and not public.tiene_permiso('falla_cambiar_contrato') then$q$),
    ('set_contratos_usuario', $q$if public.mi_rol() is distinct from 'admin' then$q$, $q$if not public.tiene_permiso('admin_usuarios') then$q$, $q$if not public.tiene_permiso('admin_usuarios') then$q$),
    ('suministro_actualizar_ahora', $q$if public.mi_rol() not in ('admin', 'ito', 'ito2') then$q$, $q$if not public.tiene_permiso('suministro_avisos') then$q$, $q$if not public.tiene_permiso('suministro_avisos') then$q$),
    ('suministro_estado', $q$if public.mi_rol() is distinct from 'admin' then$q$, $q$if not public.tiene_permiso('admin_catalogos') then$q$, $q$if not public.tiene_permiso('admin_catalogos') then$q$),
    ('suministro_set_activo', $q$if public.mi_rol() is distinct from 'admin' then$q$, $q$if not public.tiene_permiso('admin_catalogos') then$q$, $q$if not public.tiene_permiso('admin_catalogos') then$q$),
    ('ubicaciones_camiones', $q$if not (public.mi_rol() = 'admin'
          or coalesce((select ver_ubicacion from public.usuarios where id = auth.uid()), false)) then$q$, $q$if not public.tiene_permiso('ubicacion_camiones') then$q$, $q$tiene_permiso('ubicacion_camiones')$q$),
    ('validar_contratista_reparacion', $q$if rol_actual not in ('contratista', 'contratista2', 'contratista3', 'camion', 'admin') then$q$, $q$if not public.usuario_tiene_permiso(new.reparado_por, 'reparacion_cerrar') then$q$, $q$if not public.usuario_tiene_permiso(new.reparado_por, 'reparacion_cerrar') then$q$),
    ('validar_creador_falla', $q$if rol_creador not in ('ito', 'ito2', 'admin', 'contratista2', 'contratista3') then$q$, $q$if not public.usuario_tiene_permiso(new.creado_por, 'informar_falla') then$q$, $q$if not public.usuario_tiene_permiso(new.creado_por, 'informar_falla') then$q$),
    ('validar_notificador_y_fecha_falla', $q$if not coalesce(v_hab, false) then$q$, $q$if not public.usuario_tiene_permiso(new.creado_por, 'notificador_externo') then$q$, $q$if not public.usuario_tiene_permiso(new.creado_por, 'notificador_externo') then$q$),
    ('inspeccion_existente', $q$v_rol not in ('admin','ito','ito2')$q$, $q$not public.tiene_permiso('informar_inspeccion')$q$, $q$not public.tiene_permiso('informar_inspeccion')$q$),
    ('obtener_o_crear_inspeccion', $q$v_rol not in ('admin','ito','ito2')$q$, $q$not public.tiene_permiso('informar_inspeccion')$q$, $q$not public.tiene_permiso('informar_inspeccion')$q$),
    ('inspeccion_detalle', $q$u.rol in ('admin','ito2','contratista3')$q$, $q$public.tiene_permiso('inspecciones_todas')$q$, $q$public.tiene_permiso('inspecciones_todas')$q$),
    ('inspecciones_listado', $q$u.rol in ('admin','ito2','contratista3')$q$, $q$public.tiene_permiso('inspecciones_todas')$q$, $q$public.tiene_permiso('inspecciones_todas')$q$),
    ('inspecciones_recientes', $q$u.rol in ('admin','ito2','contratista3')$q$, $q$public.tiene_permiso('inspecciones_todas')$q$, $q$public.tiene_permiso('inspecciones_todas')$q$),
    ('push_falla_nueva', $q$where u.rol in ('contratista','contratista2', 'contratista3')$q$, $q$where public.usuario_tiene_permiso(u.id, 'push_falla_informada')$q$, $q$where public.usuario_tiene_permiso(u.id, 'push_falla_informada')$q$),
    ('push_falla_reparada', $q$and u.rol in ('ito','ito2','admin'))$q$, $q$and coalesce(public.usuario_tiene_permiso(u.id, 'push_falla_reparada'), false))$q$, $q$coalesce(public.usuario_tiene_permiso(u.id, 'push_falla_reparada')$q$),
    ('push_falla_reparada', $q$and u.rol in ('contratista','contratista2', 'contratista3')$q$, $q$and public.usuario_tiene_permiso(u.id, 'push_falla_reparada')$q$, $q$and public.usuario_tiene_permiso(u.id, 'push_falla_reparada')$q$),
    ('push_falla_asignada', $q$perform notificar_push(array[NEW.asignado_camion_id],$q$, $q$if not public.usuario_tiene_permiso(NEW.asignado_camion_id, 'push_falla_asignada') then return NEW; end if;
  perform notificar_push(array[NEW.asignado_camion_id],$q$, $q$usuario_tiene_permiso(NEW.asignado_camion_id$q$),
    ('crear_perfil', $q$if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador puede crear perfiles.'$q$, $q$if not public.tiene_permiso('admin_perfiles') then raise exception 'No tienes permiso para crear perfiles.'$q$, $q$if not public.tiene_permiso('admin_perfiles') then raise exception 'No tienes permiso para crear perfiles.'$q$)
  ) as t(fn, viejo, nuevo, ya) loop
    select count(*) into v_n from pg_proc p where p.proname = r.fn and p.pronamespace = 'public'::regnamespace;
    if v_n <> 1 then raise exception 'La función % no existe o está repetida (%).', r.fn, v_n; end if;
    select p.oid into v_oid from pg_proc p where p.proname = r.fn and p.pronamespace = 'public'::regnamespace;
    v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
    if position(r.ya in v_def) > 0 then continue; end if;   -- ya estaba aplicado
    if position(r.viejo in v_def) = 0 then
      raise exception 'No encontré el texto esperado en la función % (¿cambió desde que se preparó este SQL?): %', r.fn, left(r.viejo, 70);
    end if;
    execute replace(v_def, r.viejo, r.nuevo);
  end loop;
end
$do$;

-- 3) Políticas de acceso a tablas ---------------------------------------------------------------------------------------
alter policy "codigos_cierre_admin" on public.codigos_cierre
  using ((select public.tiene_permiso('admin_catalogos'))) with check ((select public.tiene_permiso('admin_catalogos')));
alter policy "codigos_falla_admin" on public.codigos_falla
  using ((select public.tiene_permiso('admin_catalogos'))) with check ((select public.tiene_permiso('admin_catalogos')));

alter policy "contratos_admin_insert" on public.contratos with check ((select public.tiene_permiso('admin_contratos')));
alter policy "contratos_admin_update" on public.contratos
  using ((select public.tiene_permiso('admin_contratos'))) with check ((select public.tiene_permiso('admin_contratos')));

alter policy "fallas_asignar_camion" on public.fallas
  using ((select public.tiene_permiso('reparacion_asignar_camion')) and public.contrato_visible(contrato_id))
  with check ((select public.tiene_permiso('reparacion_asignar_camion')));
alter policy "fallas_delete_admin" on public.fallas using ((select public.tiene_permiso('falla_editar_cualquiera')));
alter policy "fallas_insert_ito_admin" on public.fallas
  with check ((select public.tiene_permiso('informar_falla')) and creado_por = (select auth.uid()));
alter policy "fallas_update_admin" on public.fallas
  using ((select public.tiene_permiso('falla_editar_cualquiera'))) with check ((select public.tiene_permiso('falla_editar_cualquiera')));
alter policy "fallas_update_contratista_pendiente" on public.fallas
  using ((select public.tiene_permiso('reparacion_cerrar')) and estado <> 'reparada' and public.alcance_falla(contrato_id, asignado_camion_id));

alter policy "insertar_comentarios_fallas" on public.fallas_comentarios
  with check (
    autor_id = (select auth.uid())
    and (
         (tipo in ('reporte', 'masivo') and (select public.tiene_permiso('informar_falla')))
      or (tipo = 'asignacion'           and (select public.tiene_permiso('reparacion_asignar_camion')))
      or (tipo in ('pendiente', 'reparacion') and (select public.tiene_permiso('reparacion_cerrar')))
      or (tipo = 'comentario'           and (select public.tiene_permiso('falla_comentar')))
    ));

alter policy "funciones_admin_del" on public.funciones using ((select public.tiene_permiso('admin_perfiles')));
alter policy "funciones_admin_ins" on public.funciones with check ((select public.tiene_permiso('admin_perfiles')));
alter policy "funciones_admin_upd" on public.funciones
  using ((select public.tiene_permiso('admin_perfiles'))) with check ((select public.tiene_permiso('admin_perfiles')));
alter policy "perfiles_admin_del" on public.perfiles using ((select public.tiene_permiso('admin_perfiles')));
alter policy "perfiles_admin_ins" on public.perfiles with check ((select public.tiene_permiso('admin_perfiles')));
alter policy "perfiles_admin_upd" on public.perfiles
  using ((select public.tiene_permiso('admin_perfiles'))) with check ((select public.tiene_permiso('admin_perfiles')));
alter policy "perfil_funciones_admin_del" on public.perfil_funciones using ((select public.tiene_permiso('admin_perfiles')));
alter policy "perfil_funciones_admin_ins" on public.perfil_funciones with check ((select public.tiene_permiso('admin_perfiles')));
alter policy "perfil_funciones_admin_upd" on public.perfil_funciones
  using ((select public.tiene_permiso('admin_perfiles'))) with check ((select public.tiene_permiso('admin_perfiles')));

alter policy "maestros_insert" on public.maestros
  with check ((select public.tiene_permiso('maestros'))
    and (public.mi_rol() not in ('contratista', 'contratista2', 'contratista3')
         or exists (select 1 from public.usuario_contratos uc where uc.usuario_id = auth.uid() and uc.contrato_id = maestros.contrato_id)));
alter policy "maestros_update" on public.maestros
  using ((select public.tiene_permiso('maestros'))
    and (public.mi_rol() not in ('contratista', 'contratista2', 'contratista3')
         or exists (select 1 from public.usuario_contratos uc where uc.usuario_id = auth.uid() and uc.contrato_id = maestros.contrato_id)))
  with check ((select public.tiene_permiso('maestros'))
    and (public.mi_rol() not in ('contratista', 'contratista2', 'contratista3')
         or exists (select 1 from public.usuario_contratos uc where uc.usuario_id = auth.uid() and uc.contrato_id = maestros.contrato_id)));

alter policy "notificadores_delete_admin" on public.notificadores using ((select public.tiene_permiso('admin_catalogos')));
alter policy "notificadores_insert_admin" on public.notificadores with check ((select public.tiene_permiso('admin_catalogos')));
alter policy "notificadores_update_admin" on public.notificadores
  using ((select public.tiene_permiso('admin_catalogos'))) with check ((select public.tiene_permiso('admin_catalogos')));

alter policy "reparaciones_insert_contratista_admin" on public.reparaciones
  with check (reparado_por = (select auth.uid())
    and (select public.tiene_permiso('reparacion_cerrar'))
    and (public.mi_rol() <> 'camion'
         or exists (select 1 from public.fallas f where f.id = reparaciones.falla_id and f.asignado_camion_id = (select auth.uid()))));

alter policy "suministro_avisos_lee" on public.suministro_avisos using ((select public.tiene_permiso('suministro_avisos')));

alter policy "usuario_contratos_select" on public.usuario_contratos
  using ((select public.tiene_permiso('admin_usuarios')) or usuario_id = (select auth.uid()));

alter policy "usuarios_delete_admin" on public.usuarios using ((select public.tiene_permiso('admin_usuarios')));
alter policy "usuarios_insert_admin" on public.usuarios with check ((select public.tiene_permiso('admin_usuarios')));
alter policy "usuarios_update_admin" on public.usuarios using ((select public.tiene_permiso('admin_usuarios')));

-- Fotos de reparación (almacenamiento). Si tu usuario no es dueño de esa tabla, avisa y sigue sin cambiar nada ahí.
do $do$
begin
  alter policy "fotos_rep_insert" on storage.objects
    with check (bucket_id = 'fotos-reparacion' and (select public.tiene_permiso('reparacion_cerrar')));
exception when others then
  raise notice 'No se pudo actualizar la política fotos_rep_insert (%). Queda como estaba: solo roles admin/contratistas/camión.', sqlerrm;
end
$do$;

-- 4) Comprobación rápida (opcional): debería mostrar 0 funciones que aún comparan roles para decidir permisos
--    select proname from pg_proc where pronamespace='public'::regnamespace and prokind='f'
--      and pg_get_functiondef(oid) ~ 'mi_rol\(\)\s*(=|<>|is distinct from)\s*''admin''';
