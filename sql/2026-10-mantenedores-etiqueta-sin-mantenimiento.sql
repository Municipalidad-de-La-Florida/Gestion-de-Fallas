-- Agrega 'derivacion' a las propiedades de fallas_geojson (para las etiquetas "Sin mantenimiento" y "Pendiente").
-- Reescribe la función a partir de su definición actual. Se puede repetir.
begin;
do $$
declare r record; v_def text; v_nuevo text;
begin
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fallas_geojson'
  loop
    v_def := pg_get_functiondef(r.oid);
    if v_def like '%''derivacion''%' then continue; end if;
    v_nuevo := replace(v_def, '''mantenedor_id'', f.mantenedor_id', '''mantenedor_id'', f.mantenedor_id, ''derivacion'', f.derivacion');
    if v_nuevo = v_def then raise exception 'No se encontró mantenedor_id en fallas_geojson: ¿se ejecutó 2026-10-mantenedores-etiqueta.sql?'; end if;
    execute v_nuevo;
  end loop;
end $$;
commit;
