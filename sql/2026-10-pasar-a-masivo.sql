-- Botón "Pasar a masivo" (solo para los usuarios habilitados en usuarios.puede_pasar_a_masivo).
-- Una falla abierta (no cascada, no masiva) pasa a Masivo y al contrato Elecnor; si estaba asignada a un camión, se desasigna.
-- Si es una falla de circuito, sus puntos en cascada siguen al circuito (contrato y asignación) por los triggers existentes.
-- Es independiente de 2026-10-mantenedor-luminarias.sql: el mantenedor de la falla no se toca.

alter table public.usuarios add column if not exists puede_pasar_a_masivo boolean not null default false;
-- Para habilitar a un usuario:  update public.usuarios set puede_pasar_a_masivo = true where id = '<id del usuario>';
-- Para quitarlo:                update public.usuarios set puede_pasar_a_masivo = false where id = '<id del usuario>';

create or replace function public.pasar_a_masivo(p_falla uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_ok boolean;
  v_nombre text;
  v_elecnor uuid;
  f public.fallas%rowtype;
  v_txt text;
begin
  select u.puede_pasar_a_masivo, u.nombre into v_ok, v_nombre from public.usuarios u where u.id = auth.uid();
  if not coalesce(v_ok, false) then
    raise exception 'No tienes permiso para pasar fallas a masivo.';
  end if;

  select * into f from public.fallas where id = p_falla for update;
  if not found or not public.contrato_visible(f.contrato_id) then
    raise exception 'No se encontró la falla.';
  end if;
  if coalesce(f.cascada, false) then raise exception 'Esta falla sigue a su circuito: pasa el circuito a masivo.'; end if;
  if f.estado = 'reparada' then raise exception 'La falla ya está reparada.'; end if;
  if coalesce(f.masivo, false) then raise exception 'La falla ya es masiva.'; end if;

  select id into v_elecnor from public.contratos where lower(btrim(nombre)) = 'elecnor' and activo limit 1;
  if v_elecnor is null then raise exception 'No se encontró el contrato Elecnor.'; end if;

  v_txt := 'Pasada a masivo por ' || coalesce(v_nombre, 'usuario') || ' (contrato Elecnor'
           || case when f.asignado_camion_id is not null then '; se quitó la asignación al camión' else '' end || ')';

  perform set_config('app.editando_falla', '1', true);   -- evita el bloqueo de campos para contratistas
  update public.fallas
     set masivo = true,
         contrato_id = v_elecnor,
         asignado_camion_id = null,
         asignado_por_id = null
   where id = p_falla;
  -- Los puntos en cascada siguen al circuito: el contrato lo propaga el trigger; la asignación se quita aquí también por seguridad.
  update public.fallas set asignado_camion_id = null, asignado_por_id = null
   where circuito_origen_id = p_falla and asignado_camion_id is not null;

  insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
  values (p_falla, 'masivo', v_txt, auth.uid(), v_nombre);
end;
$function$;

revoke all on function public.pasar_a_masivo(uuid) from public, anon;
grant execute on function public.pasar_a_masivo(uuid) to authenticated;
