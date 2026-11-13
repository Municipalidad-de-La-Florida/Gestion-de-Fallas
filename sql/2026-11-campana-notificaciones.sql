-- Campana = bandeja de notificaciones. Todo lo que se envía como aviso al celular (falla nueva, reparada, atraso, aporte…)
-- queda también registrado por usuario, con "leída/no leída", y se borra a las 24 h.
create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  titulo text not null,
  cuerpo text not null default '',
  url text,
  falla_id uuid,
  creado_en timestamptz not null default now(),
  leida boolean not null default false
);
create index if not exists notificaciones_usuario_idx on public.notificaciones (usuario_id, creado_en desc);
alter table public.notificaciones enable row level security;
drop policy if exists notif_select on public.notificaciones;
drop policy if exists notif_update on public.notificaciones;
create policy notif_select on public.notificaciones for select to authenticated using (usuario_id = (select auth.uid()));
create policy notif_update on public.notificaciones for update to authenticated using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));
revoke all on public.notificaciones from anon;
grant select, update on public.notificaciones to authenticated;

create or replace function public.notificar_push(p_usuarios uuid[], p_titulo text, p_cuerpo text, p_url text DEFAULT './')
returns void language plpgsql security definer set search_path to 'public','extensions' as $$
declare v_url text; v_sec text; v_f uuid;
begin
  -- Registro en la campana: exactamente los mismos destinatarios que reciben el aviso al celular
  begin
    begin v_f := nullif(substring(coalesce(p_url,'') from '[?&]falla=([0-9a-fA-F-]{36})'), '')::uuid; exception when others then v_f := null; end;
    insert into public.notificaciones (usuario_id, titulo, cuerpo, url, falla_id)
      select d, p_titulo, coalesce(p_cuerpo,''), p_url, v_f from (select distinct unnest(coalesce(p_usuarios, '{}'::uuid[])) d) q
       where exists (select 1 from public.usuarios u where u.id = q.d);
  exception when others then raise warning 'notificar_push (registro): %', sqlerrm; end;

  if p_usuarios is null or coalesce(array_length(p_usuarios,1),0) = 0 then return; end if;
  select valor into v_url from push_config where clave = 'url_envio';
  select valor into v_sec from push_config where clave = 'secreto_envio';
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('usuario_ids', to_jsonb(p_usuarios), 'titulo', p_titulo, 'cuerpo', p_cuerpo, 'url', p_url),
    headers := jsonb_build_object('Content-Type','application/json','x-push-secret', v_sec));
exception when others then
  raise warning 'notificar_push: %', sqlerrm;
end $$;

-- Los avisos de atraso ahora pasan por la misma bandeja (también para el admin, aunque no haya contratista)
do $$ declare d text; begin
  select pg_get_functiondef('public.avisar_atrasos(boolean)'::regprocedure) into d;
  d := replace(d, 'if p_push and v_dest is not null then', 'if p_push then');
  d := replace(d, 'perform public.notificar_push(v_dest,', 'perform public.notificar_push(coalesce(v_dest, ''{}''::uuid[]),');
  execute d;
end $$;

-- Limpieza: nada dura más de 24 h
select cron.unschedule('limpiar-notificaciones') where exists (select 1 from cron.job where jobname = 'limpiar-notificaciones');
select cron.schedule('limpiar-notificaciones', '*/15 * * * *', $$delete from public.notificaciones where creado_en < now() - interval '24 hours'$$);

-- Los contratistas también se enteran de las fallas que ellos mismos informan y de las reparaciones que ellos mismos registran
do $$ declare d text; begin
  select pg_get_functiondef('public.push_falla_nueva()'::regprocedure) into d;
  d := replace(d, 'and u.id is distinct from coalesce(NEW.creado_por, NEW.informado_por)', 'and (u.id is distinct from coalesce(NEW.creado_por, NEW.informado_por) or u.rol in (''contratista'', ''contratista2'', ''contratista3''))');
  execute d;
  select pg_get_functiondef('public.push_falla_reparada()'::regprocedure) into d;
  d := replace(d, 'and u.id is distinct from v_repara', 'and (u.id is distinct from v_repara or u.rol in (''contratista'', ''contratista2'', ''contratista3''))');
  execute d;
end $$;
