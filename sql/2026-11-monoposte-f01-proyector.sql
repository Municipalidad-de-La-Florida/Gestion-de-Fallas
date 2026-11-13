-- Código F01 "Proyector apagado" para monopostes (la librería de códigos admite el mismo código en categorías distintas)
insert into codigos_falla (categoria, codigo, descripcion, orden, activo)
values ('monoposte', 'F01', 'Proyector apagado', 0, true)
on conflict (categoria, codigo) do nothing;
