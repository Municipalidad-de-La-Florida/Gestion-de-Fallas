-- Permiso propio para ver la ubicación de los camiones (separado del de Cuadrillas).
-- Quienes ya tenían Cuadrillas quedan con este permiso para no perder lo que ven hoy; después se ajusta en
-- Gestión de usuarios → Herramientas (web) o en la ficha del usuario (app). El administrador siempre puede verla.
-- Se puede ejecutar más de una vez.

alter table public.usuarios add column if not exists ver_ubicacion boolean not null default false;

update public.usuarios set ver_ubicacion = true where ver_cuadrillas is true and ver_ubicacion is false;

create or replace function public.ubicaciones_camiones()
returns table(usuario_id uuid, nombre text, lat double precision, lng double precision, precision_m real, actualizado_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.mi_rol() = 'admin'
          or coalesce((select ver_ubicacion from public.usuarios where id = auth.uid()), false)) then
    raise exception 'No tienes permiso para ver la ubicación de los camiones';
  end if;
  return query
    select u.id, u.nombre, c.lat, c.lng, c.precision_m, c.actualizado_en
    from public.ubicaciones_camion c join public.usuarios u on u.id = c.usuario_id
    where u.rol = 'camion' and c.actualizado_en > now() - interval '12 hours'
    order by u.nombre;
end $$;
revoke all on function public.ubicaciones_camiones() from public;
grant execute on function public.ubicaciones_camiones() to authenticated;
