-- Correo diario (lunes a viernes 9:00) a cada ITO con las fallas de la Autopista Vespucio Sur que registró y no se han enviado.
-- Requiere antes: sql/2026-10-nro-municipal-autopista.sql (columna nro_aut) y sql/2026-10-falla-correo.sql (función falla_correo).
-- Se puede ejecutar más de una vez.

alter table public.fallas add column if not exists autopista_enviada_en timestamptz;

create table if not exists public.autopista_envios (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid, enviado_en timestamptz not null default now(),
  modo text, cantidad int, fallas uuid[], ok boolean, error text
);
alter table public.autopista_envios enable row level security;   -- sin políticas: solo lo ve el administrador desde el editor SQL

-- Casilla del ITO: sus propias fallas pendientes
create or replace function public.autopista_mis_pendientes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso('falla_correo') then raise exception 'Sin permiso'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'ot', f.ot, 'orden_externa', f.orden_externa, 'tipo_falla', f.tipo_falla,
             'fecha_falla', f.fecha_falla, 'llave', p.llave, 'placa', p.nro_aut, 'lat', st_y(p.geom), 'lon', st_x(p.geom)) order by f.fecha_falla)
      from public.fallas f join public.puntos_luminarios p on p.gid = f.ref_punto_gid
     where f.tipo = 'punto' and f.cascada is not true and p.nro_aut is not null
       and f.autopista_enviada_en is null and f.creado_por = auth.uid()), '[]'::jsonb);
end $$;
revoke all on function public.autopista_mis_pendientes() from public, anon;
grant execute on function public.autopista_mis_pendientes() to authenticated;

-- Para la función de envío (solo service_role): pendientes agrupados por ITO
create or replace function public.autopista_pendientes_envio(p_usuario uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(g), '[]'::jsonb) from (
    select u.id as usuario_id, u.nombre, u.email,
           jsonb_agg(jsonb_build_object('id', f.id, 'ot', f.ot, 'orden_externa', f.orden_externa, 'tipo_falla', f.tipo_falla,
             'descripcion', cf.descripcion, 'fecha_falla', f.fecha_falla, 'llave', p.llave, 'placa', p.nro_aut,
             'lat', st_y(p.geom), 'lon', st_x(p.geom)) order by f.fecha_falla) as fallas
      from public.fallas f
      join public.puntos_luminarios p on p.gid = f.ref_punto_gid
      join public.usuarios u on u.id = f.creado_por
      left join public.codigos_falla cf on cf.codigo = f.tipo_falla
     where f.tipo = 'punto' and f.cascada is not true and p.nro_aut is not null and f.autopista_enviada_en is null
       and (p_usuario is null or f.creado_por = p_usuario)
       and public.usuario_tiene_permiso(f.creado_por, 'falla_correo')
     group by u.id, u.nombre, u.email) g;
$$;
revoke all on function public.autopista_pendientes_envio(uuid) from public, anon, authenticated;
grant execute on function public.autopista_pendientes_envio(uuid) to service_role;

create or replace function public.autopista_marcar_enviadas(p_ids uuid[], p_usuario uuid, p_modo text, p_ok boolean, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ok then update public.fallas set autopista_enviada_en = now() where id = any(p_ids); end if;
  insert into public.autopista_envios (usuario_id, modo, cantidad, fallas, ok, error) values (p_usuario, p_modo, cardinality(p_ids), p_ids, p_ok, p_error);
end $$;
revoke all on function public.autopista_marcar_enviadas(uuid[], uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.autopista_marcar_enviadas(uuid[], uuid, text, boolean, text) to service_role;

-- Programación: lunes a viernes 9:00 de Chile. Chile cambia de hora, así que se programan las 12:00 y las 13:00 UTC;
-- la función solo envía cuando en Chile son las 9:00 (la otra ejecución no hace nada).
select cron.unschedule(jobid) from cron.job where jobname in ('autopista-correo-12utc', 'autopista-correo-13utc');
select cron.schedule('autopista-correo-12utc', '0 12 * * 1-5', $$select net.http_post(url := 'https://rcwtqvhssgtufgypnobn.supabase.co/functions/v1/enviar-autopista', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)$$);
select cron.schedule('autopista-correo-13utc', '0 13 * * 1-5', $$select net.http_post(url := 'https://rcwtqvhssgtufgypnobn.supabase.co/functions/v1/enviar-autopista', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)$$);
