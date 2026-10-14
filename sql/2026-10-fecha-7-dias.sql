-- Ventana de fechas permitida: de 3 a 7 días (el admin sigue sin límite).
-- Reescribe 4 funciones cambiando "v_hoy - 3" por "v_hoy - 7" y el texto del mensaje.
do $$
declare
  f text; d text; n int := 0;
begin
  foreach f in array array[
    'public.validar_notificador_y_fecha_falla()',
    'public.obtener_o_crear_inspeccion(date,uuid)',
    'public.inspeccion_existente(date,uuid)',
    'public.editar_falla(uuid,jsonb)'
  ] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('v_hoy - 3' in d) = 0 then
      raise exception 'No se encontró la regla de 3 días en %', f;
    end if;
    d := replace(d, 'v_hoy - 3', 'v_hoy - 7');
    d := replace(d, 'últimos 3 días', 'últimos 7 días');
    execute d;
    n := n + 1;
  end loop;
  raise notice 'Funciones actualizadas: %', n;
end $$;

-- Verificación: debe devolver 4 filas con ventana_7 = true
select proname, pg_get_functiondef(oid) like '%v_hoy - 7%' as ventana_7
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('validar_notificador_y_fecha_falla','obtener_o_crear_inspeccion','inspeccion_existente','editar_falla');
