-- Las fallas reparadas (verdes) se ven 24 horas en el mapa (antes 16), en la web y en la app.
-- Cambia solo el plazo dentro de fallas_geojson; el resto de la función queda igual. Se puede ejecutar más de una vez.
do $$
declare d text; n int;
begin
  d := pg_get_functiondef('public.fallas_geojson(uuid)'::regprocedure);
  n := (length(d) - length(replace(d, $q$interval '16 hours'$q$, ''))) / length($q$interval '16 hours'$q$);
  if n = 0 then
    if position($q$interval '24 hours'$q$ in d) > 0 then
      raise notice 'fallas_geojson ya usa 24 horas; no hay nada que cambiar.';
      return;
    end if;
    raise exception 'No se encontró el plazo de 16 horas en fallas_geojson';
  end if;
  execute replace(d, $q$interval '16 hours'$q$, $q$interval '24 hours'$q$);
end $$;

-- Verificación: debe mostrar "24 hours" y no "16 hours"
select position($q$interval '24 hours'$q$ in pg_get_functiondef('public.fallas_geojson(uuid)'::regprocedure)) > 0 as usa_24h,
       position($q$interval '16 hours'$q$ in pg_get_functiondef('public.fallas_geojson(uuid)'::regprocedure)) > 0 as aun_16h;
