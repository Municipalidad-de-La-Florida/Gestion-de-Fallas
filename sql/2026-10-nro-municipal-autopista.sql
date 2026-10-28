-- Luminarias de la autopista (Vespucio Sur): en el "N.° municipal" se muestra su numeración AV001..AV116.
-- No se toca nro_mun (entero, queda vacío para estos puntos): se agrega una columna calculada y las funciones que
-- entregan el N.° municipal al mapa, informes y exportaciones devuelven la placa AV cuando corresponde.
-- Se puede ejecutar más de una vez.

-- 1) Columna calculada: placa AV solo para los puntos cuyo poste es de la autopista
alter table public.puntos_luminarios drop column if exists nro_aut;
alter table public.puntos_luminarios add column nro_aut text
  generated always as (case when prop_poste = 'AUTOPISTA VESPUCIO SUR' then placa_enel end) stored;

-- 2) Funciones que devuelven JSON: 'nro_mun' pasa a ser el número, o la placa AV si no hay número
do $do$
declare r record; d text; n text;
begin
  for r in select p.oid::regprocedure as f, p.proname
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public'
              and p.proname in ('puntos_en_area','fallas_geojson','fallas_geojson_reparadas','fallas_sueltas_ito','inspeccion_detalle','informe_reparaciones','analisis_fallas')
  loop
    d := pg_get_functiondef(r.f);
    n := replace(d, '''nro_mun'', p.nro_mun', '''nro_mun'', coalesce(to_jsonb(p.nro_mun), to_jsonb(p.nro_aut))');
    n := replace(n, '''nro_mun'', nro_mun', '''nro_mun'', coalesce(to_jsonb(nro_mun), to_jsonb(nro_aut))');
    -- analisis_fallas agrupa por p.nro_mun: hay que agrupar también por la placa
    n := replace(n, 'p.llave, p.nro_mun,', 'p.llave, p.nro_mun, p.nro_aut,');
    if n = d then raise exception 'No se pudo parchar %', r.proname; end if;
    execute n;
  end loop;
end $do$;

-- 3) Exportación: nro_mun pasa a texto (puede ser "AV001")
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.resumen_fallas_exportar(timestamp with time zone, timestamp with time zone, text, uuid[])'::regprocedure);
  n := replace(d, 'nro_mun integer', 'nro_mun text');
  n := replace(n, 'then p.nro_mun else null end as nro_mun', 'then coalesce(p.nro_mun::text, p.nro_aut) else null end as nro_mun');
  if n = d then raise exception 'No se pudo parchar resumen_fallas_exportar'; end if;
  drop function public.resumen_fallas_exportar(timestamp with time zone, timestamp with time zone, text, uuid[]);
  execute n;
  revoke all on function public.resumen_fallas_exportar(timestamp with time zone, timestamp with time zone, text, uuid[]) from public, anon;
  grant execute on function public.resumen_fallas_exportar(timestamp with time zone, timestamp with time zone, text, uuid[]) to authenticated;
end $do$;
