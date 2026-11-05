-- Permiso «ver historial» por usuario (además del que da el perfil). Se puede ejecutar más de una vez.
-- Web y app lo leen por mis_funciones() → tiene_permiso('modo_historial'); no requiere cambios en el código.
alter table public.usuarios add column if not exists ver_historial boolean not null default false;

create or replace function public.usuario_tiene_permiso(p_usuario uuid, p_funcion text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare u public.usuarios%rowtype; v_ok boolean;
begin
  if p_usuario is null then return false; end if;
  select * into u from public.usuarios where id = p_usuario;
  if not found then return false; end if;
  select pf.habilitado into v_ok from public.perfil_funciones pf where pf.perfil = u.perfil and pf.funcion = p_funcion;
  if coalesce(v_ok, false) then return true; end if;
  return coalesce(case p_funcion
    when 'notificador_externo'    then u.notificador_externo_habilitado
    when 'pasar_a_masivo'         then u.puede_pasar_a_masivo
    when 'foto_obligatoria'       then u.foto_obligatoria
    when 'rendimiento_cuadrillas' then u.ver_cuadrillas
    when 'fiscalizacion'          then u.ver_fiscalizacion
    when 'ubicacion_camiones'     then u.ver_ubicacion
    when 'informe_reparaciones'   then u.ver_informe_rep
    when 'cuaderno'               then u.ver_cuaderno
    when 'modo_historial'         then u.ver_historial
    else false end, false);
end;
$function$;
revoke all on function public.usuario_tiene_permiso(uuid, text) from public, anon;
grant execute on function public.usuario_tiene_permiso(uuid, text) to authenticated;

-- Matías Rodríguez y Fabián Bazán
update public.usuarios set ver_historial = true
 where id in ('759bb8fd-478d-4a83-b235-73a3873f9930', 'eb0c3e68-3a97-4e33-954f-285872e1daca');
