-- El contrato "Enel X - Clever" pasa a llamarse "Enel X" (etiquetas, listados, reportes: todo sale de contratos.nombre).
update public.contratos set nombre = 'Enel X' where nombre = 'Enel X - Clever';
select id, nombre from public.contratos order by nombre;
