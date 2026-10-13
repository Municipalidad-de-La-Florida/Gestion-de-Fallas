-- =====================================================================
-- Suministro Enel: lectura cada 60 minutos + botón «Actualizar ahora»
-- ---------------------------------------------------------------------
-- 1) La lectura automática a Enel pasa de cada 10 a cada 60 minutos (a la hora en punto).
-- 2) Nueva función suministro_actualizar_ahora(): la usa el botón del chip (admin, ito, ito2)
--    para pedir los datos de inmediato. Los datos llegan en ~1 minuto.
--    Protección: si ya hay una lectura en curso (menos de 2 min), no pide otra.
-- Requiere haber ejecutado antes los SQL de suministro (enel, interruptor, avisos).
-- No toca datos. Se puede ejecutar más de una vez.
-- Para volver a 10 minutos: select cron.schedule('suministro-solicitar', '*/10 * * * *', $$select public.suministro_solicitar()$$);
-- =====================================================================

create or replace function public.suministro_actualizar_ahora()
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.suministro_peticiones%rowtype;
begin
  if public.mi_rol() not in ('admin', 'ito', 'ito2') then
    raise exception 'No tienes permiso para actualizar los datos de Enel.';
  end if;
  if not coalesce((select activo from public.suministro_config where id = 1), true) then
    return jsonb_build_object('ok', false, 'motivo', 'apagado');
  end if;
  select * into p from public.suministro_peticiones where id = 1;
  if not p.procesado and p.solicitado_en > now() - interval '2 minutes' then
    return jsonb_build_object('ok', true, 'motivo', 'en_curso');   -- ya hay una lectura en camino
  end if;
  perform public.suministro_solicitar();
  return jsonb_build_object('ok', true, 'motivo', 'solicitado');
end $$;
revoke all on function public.suministro_actualizar_ahora() from public, anon;
grant execute on function public.suministro_actualizar_ahora() to authenticated;

-- Pantalla de ajustes del admin: informa «cada 60 min»
create or replace function public.suministro_estado()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede ver esto.';
  end if;
  return jsonb_build_object(
    'activo',         coalesce((select activo from public.suministro_config where id = 1), true),
    'ultima_lectura', (select actualizado_en from public.suministro_enel where id = 1),
    'solicitado_en',  (select solicitado_en from public.suministro_peticiones where id = 1),
    'error',          (select error from public.suministro_peticiones where id = 1),
    'trafos',         (select count(*) from public.suministro_trafos),
    'avisos',         (select count(*) from public.suministro_avisos),
    'cada_min',       60);
end $$;
revoke all on function public.suministro_estado() from public, anon;
grant execute on function public.suministro_estado() to authenticated;

-- Programación: pedir a Enel cada hora en punto (el procesamiento sigue revisando cada minuto)
select cron.unschedule(jobid) from cron.job where jobname = 'suministro-solicitar';
select cron.schedule('suministro-solicitar', '0 * * * *', $$select public.suministro_solicitar()$$);

-- Resultado: debe mostrar la programación nueva
select jobname, schedule from cron.job where jobname like 'suministro%' order by jobname;
