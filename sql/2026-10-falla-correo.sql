-- Función «Correo diario de fallas de la autopista»: quién lo recibe se define por perfil en Administración > Perfiles y permisos (por defecto admin, ito, ito2).
-- Se puede ejecutar más de una vez.
insert into public.funciones (clave, grupo, nombre, orden, por_usuario)
values ('falla_correo', 'Gestión de una falla', 'Recibir correo diario de fallas de la autopista', 70, false)
on conflict (clave) do update set grupo = excluded.grupo, nombre = excluded.nombre, orden = excluded.orden, por_usuario = excluded.por_usuario;

insert into public.perfil_funciones (perfil, funcion, habilitado)
select p.clave, 'falla_correo', p.clave in ('admin', 'ito', 'ito2') from public.perfiles p
on conflict (perfil, funcion) do nothing;
