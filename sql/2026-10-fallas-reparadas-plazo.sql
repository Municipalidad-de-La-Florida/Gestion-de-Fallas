-- Reparadas visibles en el mapa de la app con plazo elegible (hasta 30 días).
-- Crea fallas_geojson_reparadas(p_horas) a partir de fallas_geojson, devolviendo SOLO las reparadas
-- dentro del plazo. No modifica fallas_geojson (la sigue usando la web y la app).
do $$
declare d text; viejo text;
begin
  d := pg_get_functiondef('public.fallas_geojson(uuid)'::regprocedure);
  viejo := $q$((p_id is not null and f.id = p_id) or (p_id is null and (f.estado <> 'reparada' or r.fecha_reparacion > (now() - interval '16 hours'))))$q$;
  if length(d) - length(replace(d, viejo, '')) <> 2 * length(viejo) then
    raise exception 'No se encontraron las 2 condiciones esperadas en fallas_geojson';
  end if;
  d := replace(d, viejo,
    $q$(f.estado = 'reparada' and r.fecha_reparacion > (now() - make_interval(hours => least(greatest(coalesce(p_horas, 16), 1), 720))))$q$);
  d := replace(d, 'public.fallas_geojson(p_id uuid DEFAULT NULL::uuid)', 'public.fallas_geojson_reparadas(p_horas integer DEFAULT 16)');
  if position('fallas_geojson_reparadas' in d) = 0 then
    raise exception 'No se pudo renombrar la función';
  end if;
  execute d;
end $$;

revoke all on function public.fallas_geojson_reparadas(integer) from public;
grant execute on function public.fallas_geojson_reparadas(integer) to authenticated;

-- Verificación: debe devolver la cantidad de reparadas de los últimos 7 días (7 días = 168 h)
select jsonb_array_length(public.fallas_geojson_reparadas(168) -> 'features') as reparadas_7_dias;
