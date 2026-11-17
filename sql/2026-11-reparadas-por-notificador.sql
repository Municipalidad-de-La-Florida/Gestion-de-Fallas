-- Plazo de las reparadas (verdes) por notificador. Hoy: 24 horas para todas; las fallas que informa "SAT ENEL" se ven 72 horas (3 días).
-- Para quitarlo o cambiarlo:  update public.notificadores set reparadas_horas = null where nombre = 'SAT ENEL';   (null = 24 horas)
alter table public.notificadores add column if not exists reparadas_horas integer check (reparadas_horas is null or reparadas_horas between 1 and 720);
update public.notificadores set reparadas_horas = 72 where nombre = 'SAT ENEL';

do $$
declare d text; viejo text := $q$r.fecha_reparacion > (now() - interval '24 hours')$q$;
begin
  d := pg_get_functiondef('public.fallas_geojson(uuid)'::regprocedure);
  if position('reparadas_horas' in d) > 0 then raise notice 'Ya está aplicado.'; return; end if;
  if (length(d) - length(replace(d, viejo, ''))) <> 2 * length(viejo) then raise exception 'No se encontraron las 2 condiciones esperadas'; end if;
  d := replace(d, viejo, $q$r.fecha_reparacion > (now() - make_interval(hours => coalesce(nt.reparadas_horas, 24)))$q$);
  -- se une el notificador de la falla (si lo hay) en cada una de las 2 consultas
  d := replace(d, E'    left join public.usuarios ur2 on ur2.id = f.creado_por', E'    left join public.notificadores nt on nt.id = f.notificador_id\r\n    left join public.usuarios ur2 on ur2.id = f.creado_por');
  execute d;
end $$;
select position('reparadas_horas' in pg_get_functiondef('public.fallas_geojson(uuid)'::regprocedure)) > 0 as aplicado;
