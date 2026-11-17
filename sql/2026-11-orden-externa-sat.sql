-- La orden externa acepta también el prefijo T (SAT): S-123, E-123 o T-123.
-- Actualiza editar_falla, editar_reparacion, crear_falla_punto y crear_falla_circuito. Se puede ejecutar más de una vez.
do $$
declare r record; d text;
begin
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc like '%^[SE]-%' loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, '^[SE]-', '^[SET]-');
    d := replace(d, 'empresa + número (S-123 o E-123)', 'empresa + número (S-123, E-123 o T-123)');
    execute d;
  end loop;
end $$;
