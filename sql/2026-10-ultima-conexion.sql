-- ÚLTIMA CONEXIÓN de cada usuario (web y app). Se puede ejecutar más de una vez.
-- La web y la app avisan al abrirse (como máximo una vez cada 5 minutos); Gestión de usuarios la muestra.
alter table public.usuarios add column if not exists ultima_conexion timestamptz;

create or replace function public.registrar_conexion()
returns void language sql security definer set search_path = public as $$
  update public.usuarios set ultima_conexion = now()
   where id = auth.uid() and (ultima_conexion is null or ultima_conexion < now() - interval '5 minutes');
$$;
revoke all on function public.registrar_conexion() from public, anon;
grant execute on function public.registrar_conexion() to authenticated;
