-- Estadísticas / informe de análisis: el tiempo de reparación se cierra cuando la falla quedó PENDIENTE
-- (las pendientes suelen depender de terceros y no deben inflar los tiempos). La ficha y los avisos de atraso NO cambian.
-- El tiempo total real (hasta la reparación) se entrega aparte: *_real en 'resumen'.
-- También la antigüedad de las abiertas se detiene en la fecha en que quedaron pendientes.
do $$ declare d text; begin
  select pg_get_functiondef('public.analisis_fallas(date,date,text,boolean,uuid[],uuid,uuid[])'::regprocedure) into d;
  d := replace(d, 'as dias_ing' || E'\n' || '    from public.fallas f',
    'as dias_ing,' || E'\n' || '           case when r.fecha_reparacion is null or coalesce(f.es_aporte, false) then null else greatest(0, extract(epoch from (r.fecha_reparacion - f.fecha_falla)) / 86400.0) end as dias_insp_real,' || E'\n' ||
    '           case when r.fecha_reparacion is null or coalesce(f.es_aporte, false) then null else greatest(0, extract(epoch from (r.fecha_reparacion - f.fecha_falla_real)) / 86400.0) end as dias_ing_real' || E'\n' || '    from public.fallas f');
  d := replace(d, 'else greatest(0, extract(epoch from (r.fecha_reparacion - f.fecha_falla)) / 86400.0) end      as dias_insp',
                  'else greatest(0, extract(epoch from (least(r.fecha_reparacion, coalesce(f.fecha_pendiente, r.fecha_reparacion)) - f.fecha_falla)) / 86400.0) end      as dias_insp');
  d := replace(d, 'else greatest(0, extract(epoch from (r.fecha_reparacion - f.fecha_falla_real)) / 86400.0) end as dias_ing,',
                  'else greatest(0, extract(epoch from (least(r.fecha_reparacion, coalesce(f.fecha_pendiente, r.fecha_reparacion)) - f.fecha_falla_real)) / 86400.0) end as dias_ing,');
  d := replace(d, '''media_recortada_dias_ing'', public.media_recortada(array_agg(dias_ing)),',
                  '''media_recortada_dias_ing'', public.media_recortada(array_agg(dias_ing)), ''media_recortada_dias_ing_real'', public.media_recortada(array_agg(dias_ing_real)), ''mediana_dias_ing_real'', round((percentile_cont(0.5) within group (order by dias_ing_real))::numeric, 3), ''media_recortada_dias_insp_real'', public.media_recortada(array_agg(dias_insp_real)),');
  d := replace(d, '(now() - fecha_falla)', '(least(now(), coalesce(fecha_pendiente, now())) - fecha_falla)');
  execute d;
end $$;
