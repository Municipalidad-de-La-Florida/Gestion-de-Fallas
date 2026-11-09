-- Aportes: hasta 4 fotos en total (antes 3), con al menos 1 de antes y 1 de después.
-- Se cambia solo el límite dentro de registrar_aporte.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'registrar_aporte' and p.pronamespace = 'public'::regnamespace;
  if v_def not like '%v_total > 3%' then raise exception 'registrar_aporte ya no tiene el límite esperado'; end if;
  v_def := replace(replace(v_def, 'v_total > 3', 'v_total > 4'), 'Máximo 3 fotos por falla', 'Máximo 4 fotos por falla');
  execute v_def;
end $$;
