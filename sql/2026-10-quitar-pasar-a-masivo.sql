-- Quitar la función «Pasar a masivo» (ya no existe el botón en la app ni en la web). Se puede ejecutar más de una vez.
-- No se borra la columna usuarios.puede_pasar_a_masivo: la usan otras funciones de permisos y borrarla las rompería.
delete from public.perfil_funciones where funcion = 'pasar_a_masivo';
delete from public.funciones where clave = 'pasar_a_masivo';
update public.usuarios set puede_pasar_a_masivo = false where puede_pasar_a_masivo;
drop function if exists public.pasar_a_masivo(uuid);
