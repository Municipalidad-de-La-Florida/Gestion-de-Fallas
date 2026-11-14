-- Editar el motivo con que una falla quedó pendiente (solo admin). Actualiza la falla y su comentario del historial.
-- Ejecutar completo en el SQL Editor (elegir "Run without RLS" si pregunta). Idempotente.
create or replace function public.editar_motivo_pendiente(p_falla_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_mot text := nullif(btrim(p_motivo), ''); f public.fallas%rowtype; v_id bigint;
begin
  if coalesce((select rol from public.usuarios where id = auth.uid()), '') <> 'admin' then
    raise exception 'Solo el administrador puede editar el motivo del pendiente';
  end if;
  if v_mot is null then raise exception 'El motivo no puede estar vacío'; end if;
  select * into f from public.fallas where id = p_falla_id for update;
  if not found or f.estado <> 'pendiente' then raise exception 'La falla no está pendiente'; end if;
  perform set_config('app.editando_falla', '1', true);
  update public.fallas set motivo_pendiente = v_mot where id = p_falla_id or circuito_origen_id = p_falla_id;
  select id into v_id from public.fallas_comentarios where falla_id = p_falla_id and tipo = 'pendiente' order by creado_en desc limit 1;
  if v_id is not null then update public.fallas_comentarios set comentario = v_mot where id = v_id; end if;
  perform set_config('app.editando_falla', '', true);
end $$;
grant execute on function public.editar_motivo_pendiente(uuid, text) to authenticated;
