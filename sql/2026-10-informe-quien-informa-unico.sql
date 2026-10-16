-- Informes: «Quién informa» ya no duplica personas (Pablo Alvarado, Verónica Elguin, etc.), que existen
-- a la vez como usuario y como notificador, y agrupa a todos los contratistas (contratista, contratista2,
-- contratista3) bajo una sola fila «Contratista».
-- Parcha analisis_fallas() en la base tal como está hoy. Se puede ejecutar más de una vez.
do $$
declare
  v_def text;
  v_nuevo text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'analisis_fallas';
  if v_def is null then raise exception 'No existe public.analisis_fallas'; end if;

  if v_def like '%then ''Contratista''%' then
    raise notice 'Ya estaba aplicado'; return;
  end if;

  v_nuevo := regexp_replace(
    v_def,
    'left join \(select id, nombre from public\.usuarios union all select id, nombre from public\.notificadores\) u on u\.id = coalesce\(b\.notificador_id, b\.informado_por, b\.creado_por\)\s+group by u\.id, u\.nombre',
    E'left join (select id, case when rol like ''contratista%'' then ''Contratista'' else nombre end as nombre from public.usuarios union all select id, nombre from public.notificadores) u on u.id = coalesce(b.notificador_id, b.informado_por, b.creado_por)\n        group by u.nombre');

  if v_nuevo = v_def then raise exception 'No se encontró el bloque por_ito para parchar'; end if;
  execute v_nuevo;
end $$;
