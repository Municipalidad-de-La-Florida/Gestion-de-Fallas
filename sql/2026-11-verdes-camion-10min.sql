-- Cuadrillas (rol 'camion'): las fallas reparadas (verdes) se ven solo 10 minutos y luego desaparecen.
-- Los contratistas siguen con reparadas_horas del notificador (24 h por defecto); el resto, 24 h.
do $m$
declare d text; viejo text := $q$make_interval(hours => case when public.mi_rol() in ('contratista','contratista2','contratista3','camion') then coalesce(nt.reparadas_horas, 24) else 24 end)$q$;
nuevo text := $q$(case when public.mi_rol() = 'camion' then interval '10 minutes' else make_interval(hours => case when public.mi_rol() in ('contratista','contratista2','contratista3') then coalesce(nt.reparadas_horas, 24) else 24 end) end)$q$;
begin
  d := pg_get_functiondef('public.fallas_geojson(uuid)'::regprocedure);
  if position(viejo in d) = 0 then raise exception 'No se encontró la condición esperada'; end if;
  execute replace(d, viejo, nuevo);
end $m$;
