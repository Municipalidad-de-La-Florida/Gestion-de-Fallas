-- =====================================================================
-- Interruptor del suministro Enel (solo admin)
-- ---------------------------------------------------------------------
-- Requiere haber ejecutado antes sql/2026-10-suministro-enel.sql.
-- · Apagado: el servidor deja de consultar a Enel y el indicador / los
--   transformadores se ocultan para todos los usuarios.
-- · Encendido: vuelve a consultar al instante.
-- Solo el admin puede cambiarlo (lo exige la base, no solo la pantalla).
-- Se puede ejecutar más de una vez.
-- =====================================================================

create table if not exists public.suministro_config (
  id              int primary key default 1 check (id = 1),
  activo          boolean not null default true,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid
);
insert into public.suministro_config (id) values (1) on conflict do nothing;

alter table public.suministro_config enable row level security;
drop policy if exists suministro_config_lee on public.suministro_config;
create policy suministro_config_lee on public.suministro_config for select to authenticated using (true);
revoke all on public.suministro_config from anon, authenticated;
grant select on public.suministro_config to authenticated;

-- La lectura a Enel respeta el interruptor (misma función de antes, con la guarda al inicio)
create or replace function public.suministro_solicitar()
returns void language plpgsql security definer set search_path = public, extensions, net as $$
declare r1 bigint; r2 bigint;
begin
  if not coalesce((select activo from public.suministro_config where id = 1), true) then
    return;   -- apagado por el administrador
  end if;
  r1 := net.http_get('https://mapaemergencia.enel.com/galeria/documento/me-capa-comunasAfectadas.txt',
                     timeout_milliseconds := 30000);
  r2 := net.http_get('https://mapaemergencia.enel.com/galeria/documento/me-capa-trafosAfectados.txt',
                     timeout_milliseconds := 60000);
  update public.suministro_peticiones
     set req_comunas = r1, req_trafos = r2, solicitado_en = now(), procesado = false, error = null
   where id = 1;
  -- Mantenimiento: el historial de ejecuciones de pg_cron no crece sin límite
  begin
    delete from cron.job_run_details where end_time < now() - interval '2 days';
  exception when others then null;
  end;
end $$;
revoke all on function public.suministro_solicitar() from public, anon, authenticated;

-- Cambiar el interruptor (solo admin). Al encender, pide los datos de inmediato.
create or replace function public.suministro_set_activo(p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede cambiar esto.';
  end if;
  update public.suministro_config
     set activo = p_activo, actualizado_en = now(), actualizado_por = auth.uid()
   where id = 1;
  if p_activo then perform public.suministro_solicitar(); end if;
end $$;
revoke all on function public.suministro_set_activo(boolean) from public, anon;
grant execute on function public.suministro_set_activo(boolean) to authenticated;

-- Estado para la pantalla de ajustes (solo admin): interruptor, última lectura y último error
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
    'cada_min',       10);
end $$;
revoke all on function public.suministro_estado() from public, anon;
grant execute on function public.suministro_estado() to authenticated;
