-- Ubicación de camiones: cada camión que active «Compartir mi ubicación» en la app envía su última posición
-- (solo mientras la app está abierta). Se guarda solo la ÚLTIMA posición de cada camión (sin historial).
-- La ven el administrador y los usuarios con el permiso de Cuadrillas (ver_cuadrillas).
-- Se puede ejecutar más de una vez.

create table if not exists public.ubicaciones_camion (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  precision_m real,
  actualizado_en timestamptz not null default now()
);
alter table public.ubicaciones_camion enable row level security;
-- Sin políticas: solo se escribe / lee con las funciones de abajo.

create or replace function public.reportar_ubicacion(p_lat double precision, p_lng double precision, p_precision real default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.mi_rol() <> 'camion' then return; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return; end if;
  insert into public.ubicaciones_camion (usuario_id, lat, lng, precision_m, actualizado_en)
  values (auth.uid(), p_lat, p_lng, p_precision, now())
  on conflict (usuario_id) do update
    set lat = excluded.lat, lng = excluded.lng, precision_m = excluded.precision_m, actualizado_en = now();
end $$;

-- El camión borra su última posición al dejar de compartir
create or replace function public.borrar_mi_ubicacion()
returns void language sql security definer set search_path = public as $$
  delete from public.ubicaciones_camion where usuario_id = auth.uid();
$$;

create or replace function public.ubicaciones_camiones()
returns table(usuario_id uuid, nombre text, lat double precision, lng double precision, precision_m real, actualizado_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.mi_rol() = 'admin'
          or coalesce((select ver_cuadrillas from public.usuarios where id = auth.uid()), false)) then
    raise exception 'No tienes permiso para ver la ubicación de los camiones';
  end if;
  return query
    select u.id, u.nombre, c.lat, c.lng, c.precision_m, c.actualizado_en
    from public.ubicaciones_camion c join public.usuarios u on u.id = c.usuario_id
    where u.rol = 'camion' and c.actualizado_en > now() - interval '12 hours'
    order by u.nombre;
end $$;

revoke all on function public.reportar_ubicacion(double precision, double precision, real) from public;
revoke all on function public.borrar_mi_ubicacion() from public;
revoke all on function public.ubicaciones_camiones() from public;
grant execute on function public.reportar_ubicacion(double precision, double precision, real) to authenticated;
grant execute on function public.borrar_mi_ubicacion() to authenticated;
grant execute on function public.ubicaciones_camiones() to authenticated;
