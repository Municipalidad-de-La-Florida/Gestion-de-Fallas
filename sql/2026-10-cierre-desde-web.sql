-- Cerrar fallas desde el computador con fotos OPCIONALES.
-- En la app del teléfono, quien tiene "foto obligatoria" sigue necesitando foto.
-- La web usa registrar_reparacion_web, que marca la sesión y salta esa exigencia.
do $$
declare d text;
begin
  -- 1) registrar_reparacion: respeta la marca de la web
  d := pg_get_functiondef('public.registrar_reparacion(uuid,text)'::regprocedure);
  if position('if coalesce((select foto_obligatoria' in d) = 0 then
    raise exception 'No se encontró la exigencia de foto en registrar_reparacion';
  end if;
  d := replace(d, 'if coalesce((select foto_obligatoria',
    'if coalesce(current_setting(''app.cierre_web'', true), '''') <> ''1'' and coalesce((select foto_obligatoria');
  execute d;

  -- 2) trigger exigir_foto_reparacion: igual
  d := pg_get_functiondef('public.exigir_foto_reparacion()'::regprocedure);
  if position('if coalesce((select foto_obligatoria' in d) = 0 then
    raise exception 'No se encontró la exigencia de foto en exigir_foto_reparacion';
  end if;
  d := replace(d, 'if coalesce((select foto_obligatoria',
    'if coalesce(current_setting(''app.cierre_web'', true), '''') <> ''1'' and coalesce((select foto_obligatoria');
  execute d;
end $$;

-- 3) RPC para la web
create or replace function public.registrar_reparacion_web(p_falla_id uuid, p_descripcion text)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
begin
  perform set_config('app.cierre_web', '1', true);   -- solo dentro de esta transacción
  return public.registrar_reparacion(p_falla_id, p_descripcion);
end;
$$;
revoke all on function public.registrar_reparacion_web(uuid, text) from public;
grant execute on function public.registrar_reparacion_web(uuid, text) to authenticated;

-- Verificación: debe devolver 3 filas con true
select 'registrar_reparacion' as f, pg_get_functiondef('public.registrar_reparacion(uuid,text)'::regprocedure) like '%app.cierre_web%' as ok
union all select 'exigir_foto_reparacion', pg_get_functiondef('public.exigir_foto_reparacion()'::regprocedure) like '%app.cierre_web%'
union all select 'registrar_reparacion_web', to_regprocedure('public.registrar_reparacion_web(uuid,text)') is not null;
