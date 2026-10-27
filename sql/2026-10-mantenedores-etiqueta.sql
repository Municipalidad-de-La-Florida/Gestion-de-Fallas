-- Etiqueta del mantenedor junto a la del contrato (después de 2026-10-mantenedores-etapa1.sql).
-- Agrega 'mantenedor_id' a las propiedades que devuelven fallas_geojson y fallas_geojson_periodo,
-- reescribiendo cada función a partir de su definición actual (no toca nada más). Se puede repetir.
begin;

do $$
declare r record; v_def text; v_nuevo text;
begin
  for r in select p.oid, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname in ('fallas_geojson', 'fallas_geojson_periodo')
  loop
    v_def := pg_get_functiondef(r.oid);
    if v_def like '%''mantenedor_id''%' then continue; end if;                       -- ya está
    v_nuevo := replace(v_def, '''contrato_id'', f.contrato_id', '''contrato_id'', f.contrato_id, ''mantenedor_id'', f.mantenedor_id');
    if v_nuevo = v_def then
      raise notice 'No se encontró contrato_id en % (%): sin cambios', r.proname, r.oid::regprocedure;
      continue;
    end if;
    execute v_nuevo;
  end loop;
end $$;

commit;
