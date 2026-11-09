-- «Cerrada sin mantención»: el admin cierra una falla que no tiene quién la repare (luminaria sin contrato, en recepción, de otro servicio…),
-- con un motivo OBLIGATORIO. Sale de las fallas activas, de los atrasos y de los tiempos de estadísticas; queda en el historial y se puede reabrir.

-- 1) Estado y columnas
alter table public.fallas drop constraint if exists fallas_estado_check;
alter table public.fallas add constraint fallas_estado_check check (estado = any (array['reportada','pendiente','reparada','reiterada','cerrada']));
alter table public.fallas add column if not exists cerrada_en timestamptz;
alter table public.fallas add column if not exists cerrada_por uuid references public.usuarios(id);
alter table public.fallas add column if not exists motivo_cierre text;
alter table public.fallas_comentarios drop constraint if exists fallas_comentarios_tipo_check;
alter table public.fallas_comentarios add constraint fallas_comentarios_tipo_check
  check (tipo = any (array['reporte','asignacion','pendiente','reparacion','masivo','comentario','aporte','cierre']));

-- 2) Cerrar (solo admin, con motivo) y reabrir
create or replace function public.cerrar_sin_mantencion(p_falla_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; v_m text := btrim(coalesce(p_motivo, '')); v_n int; v_nom text;
begin
  if not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin') then raise exception 'Solo el administrador puede cerrar una falla sin mantención'; end if;
  if char_length(v_m) < 10 then raise exception 'Escribe el motivo del cierre (al menos 10 caracteres)'; end if;
  select * into f from public.fallas where id = p_falla_id;
  if not found then raise exception 'Falla no encontrada'; end if;
  if f.cascada then raise exception 'Cierra el circuito, no cada punto afectado'; end if;
  if f.estado in ('reparada', 'cerrada') then raise exception 'La falla ya está %', case f.estado when 'reparada' then 'reparada' else 'cerrada' end; end if;
  perform set_config('app.editando_falla', '1', true);
  update public.fallas set estado = 'cerrada', cerrada_en = now(), cerrada_por = auth.uid(), motivo_cierre = v_m
   where (id = p_falla_id or circuito_origen_id = p_falla_id) and estado not in ('reparada', 'cerrada');
  get diagnostics v_n = row_count;
  select nombre into v_nom from public.usuarios where id = auth.uid();
  insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre) values (p_falla_id, 'cierre', v_m, auth.uid(), v_nom);
  delete from public.notificaciones_atraso where falla_id in (select id from public.fallas where id = p_falla_id or circuito_origen_id = p_falla_id);
  delete from public.atraso_avisos where falla_id in (select id from public.fallas where id = p_falla_id or circuito_origen_id = p_falla_id);
  return jsonb_build_object('ok', true, 'cerradas', v_n);
end $$;
revoke all on function public.cerrar_sin_mantencion(uuid, text) from public, anon;
grant execute on function public.cerrar_sin_mantencion(uuid, text) to authenticated;

create or replace function public.reabrir_cerrada(p_falla_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; v_nom text;
begin
  if not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin') then raise exception 'Solo el administrador puede reabrir una falla'; end if;
  select * into f from public.fallas where id = p_falla_id;
  if not found or f.estado <> 'cerrada' or f.cascada then raise exception 'La falla no está cerrada sin mantención'; end if;
  perform set_config('app.editando_falla', '1', true);
  begin
    update public.fallas set estado = 'reportada', cerrada_en = null, cerrada_por = null, motivo_cierre = null
     where (id = p_falla_id or circuito_origen_id = p_falla_id) and estado = 'cerrada';
  exception when unique_violation then raise exception 'No se puede reabrir: ya hay otra falla activa en ese punto o circuito';
  end;
  select nombre into v_nom from public.usuarios where id = auth.uid();
  insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre) values (p_falla_id, 'comentario', 'Falla reabierta (antes cerrada sin mantención).', auth.uid(), v_nom);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.reabrir_cerrada(uuid) from public, anon;
grant execute on function public.reabrir_cerrada(uuid) to authenticated;

-- 3) Una falla cerrada ya no cuenta como «activa» en las funciones que miran «no reparada»
do $$ declare nm text; d text; begin
  foreach nm in array array['anular_reparacion(uuid,text)','asignar_camion_inspeccion(uuid,uuid,boolean)','cuaderno_informar(uuid,uuid)','editar_falla(uuid,jsonb)',
      'fallas_geojson(uuid)','fiscalizacion_fallas()','operativos_periodo(date,date)','propagar_estado_pendiente_cascada()',
      'registrar_aporte(uuid,uuid,text,integer,text,text,text,uuid,text,jsonb)'] loop
    select pg_get_functiondef(nm::regprocedure) into d;
    d := replace(d, 'estado <> ''reparada''', 'estado not in (''reparada'', ''cerrada'')');
    if nm = 'fallas_geojson(uuid)' then
      d := replace(d, '''fecha_asignacion'', f.fecha_asignacion', '''fecha_asignacion'', f.fecha_asignacion, ''motivo_cierre'', f.motivo_cierre, ''cerrada_en'', f.cerrada_en');
    end if;
    execute d;
  end loop;
  select pg_get_functiondef('public.validar_una_falla_activa_por_uso()'::regprocedure) into d;
  d := replace(d, 'new.estado is distinct from ''reparada''', 'coalesce(new.estado, '''') not in (''reparada'', ''cerrada'')');
  d := replace(d, 'f.estado <> ''reparada''', 'f.estado not in (''reparada'', ''cerrada'')');
  execute d;
end $$;

-- 4) Estadísticas: las cerradas sin mantención no entran a los tiempos ni a «abiertas»; se cuentan aparte
do $$ declare d text; begin
  select pg_get_functiondef('public.analisis_fallas(date,date,text,boolean,uuid[],uuid,uuid[])'::regprocedure) into d;
  d := replace(d, 'where f.cascada = false' || E'\n', 'where f.cascada = false and f.estado <> ''cerrada''' || E'\n');
  d := replace(d, '''fallas'', count(*),' || E'\n' || '        ''reparadas'', count(fecha_reparacion),' || E'\n' || '        ''abiertas'',',
                  '''cerradas_sin_mantencion'', (select count(*) from public.fallas fz where fz.cascada = false and fz.estado = ''cerrada'' and fz.fecha_falla >= v_ini and fz.fecha_falla < v_fin),' || E'\n' || '        ''fallas'', count(*),' || E'\n' || '        ''reparadas'', count(fecha_reparacion),' || E'\n' || '        ''abiertas'',');
  execute d;
  select pg_get_functiondef('public.estadisticas_fallas(timestamptz,timestamptz,text,boolean,uuid[],uuid[])'::regprocedure) into d;
  d := replace(d, 'select f.*' || E'\r\n' || '    from public.fallas f', 'select f.*' || E'\r\n' || '    from public.fallas f');
  d := replace(d, 'where (p_masivo is null or coalesce(pa.masivo, f.masivo, false) = p_masivo)', 'where f.estado <> ''cerrada'' and (p_masivo is null or coalesce(pa.masivo, f.masivo, false) = p_masivo)');
  d := replace(d, '''reparadas'',          count(*) filter', '''cerradas_sin_mantencion'', (select count(*) from public.fallas fz where fz.cascada = false and fz.estado = ''cerrada'' and fz.fecha_falla >= fecha_inicio and fz.fecha_falla < fecha_fin),' || E'\r\n' || '    ''reparadas'',          count(*) filter');
  execute d;
end $$;

-- 5) Historial: se agregan los datos del cierre
drop function if exists public.historial_entidad(text, integer);
create function public.historial_entidad(tipo_entidad text, entidad_gid integer)
returns table(falla_id uuid, ot text, tipo_falla text, cascada boolean, fecha_falla timestamptz, estado text, nombre_creador text,
              pendiente_por_nombre text, fecha_pendiente timestamptz, motivo_pendiente text, reparado_por_nombre text,
              fecha_reparacion timestamptz, descripcion_reparacion text, cerrada_en timestamptz, cerrada_por_nombre text, motivo_cierre text)
language sql stable set search_path = public as $$
  select f.id, f.ot, f.tipo_falla, f.cascada, f.fecha_falla, f.estado,
    ui.nombre, up.nombre, f.fecha_pendiente, f.motivo_pendiente, ur.nombre, r.fecha_reparacion, r.descripcion,
    f.cerrada_en, uc.nombre, f.motivo_cierre
  from public.fallas f
  left join (select id, nombre from public.usuarios union all select id, nombre from public.notificadores) ui on ui.id = coalesce(f.notificador_id, f.informado_por)
  left join public.usuarios up on up.id = f.pendiente_por
  left join public.usuarios uc on uc.id = f.cerrada_por
  left join lateral (select * from public.reparaciones r2 where r2.falla_id = f.id order by r2.fecha_reparacion desc limit 1) r on true
  left join public.usuarios ur on ur.id = r.reparado_por
  where (tipo_entidad = 'punto' and f.tipo = 'punto' and f.ref_punto_gid = entidad_gid)
     or (tipo_entidad = 'linea' and f.tipo = 'linea' and f.ref_circuito_gid = entidad_gid)
  order by f.fecha_falla desc;
$$;
revoke all on function public.historial_entidad(text, integer) from public, anon;
grant execute on function public.historial_entidad(text, integer) to authenticated;
