-- 1) Reparación: hasta 4 fotos por falla (antes 3)
-- 2) Foto opcional al REGISTRAR la falla ("foto del reporte"): 1 por falla, en tabla aparte para no
--    mezclarse con las fotos de la reparación (informes de reparaciones, exigir foto, anular reparación).
--    La sube quien reportó (permiso informar_falla), solo a una falla creada por él.

-- 1) Límite de la reparación
create or replace function public.registrar_foto_falla(p_falla_id uuid, p_ruta text, p_bytes integer)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_rol text; v_id uuid; v_n int;
begin
  select rol into v_rol from usuarios where id = auth.uid();
  if v_rol is null or not public.tiene_permiso('reparacion_cerrar') then
    raise exception 'No tienes permiso para adjuntar fotos';
  end if;
  if not exists (select 1 from fallas where id = p_falla_id) then raise exception 'La falla no existe'; end if;
  if p_ruta is null or left(p_ruta, length(p_falla_id::text) + 1) <> p_falla_id::text || '/' then
    raise exception 'Ruta de foto no válida';
  end if;
  select count(*) into v_n from fallas_fotos where falla_id = p_falla_id;
  if v_n >= 4 then raise exception 'Máximo 4 fotos por falla'; end if;
  insert into fallas_fotos (falla_id, ruta, bytes, subido_por) values (p_falla_id, p_ruta, p_bytes, auth.uid()) returning id into v_id;
  return v_id;
end $function$;

-- 2) Foto del reporte
create table if not exists public.fallas_foto_reporte (
  id         uuid primary key default gen_random_uuid(),
  falla_id   uuid not null unique references public.fallas(id) on delete cascade,
  ruta       text not null unique,
  bytes      integer,
  subido_por uuid references public.usuarios(id),
  creado_en  timestamptz not null default now()
);
alter table public.fallas_foto_reporte enable row level security;
drop policy if exists fallas_foto_reporte_select on public.fallas_foto_reporte;
create policy fallas_foto_reporte_select on public.fallas_foto_reporte for select
  using (exists (select 1 from public.usuarios u where u.id = auth.uid()));
revoke all on public.fallas_foto_reporte from anon, public;
grant select on public.fallas_foto_reporte to authenticated;

create or replace function public.registrar_foto_reporte(p_falla_id uuid, p_ruta text, p_bytes integer)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid;
begin
  if auth.uid() is null or not public.tiene_permiso('informar_falla') then
    raise exception 'No tienes permiso para adjuntar fotos al reporte';
  end if;
  if not exists (select 1 from fallas where id = p_falla_id and creado_por = auth.uid()) then
    raise exception 'Solo puedes adjuntar la foto a una falla que tú reportaste';
  end if;
  if p_ruta is null or left(p_ruta, length(p_falla_id::text) + 1) <> p_falla_id::text || '/' then
    raise exception 'Ruta de foto no válida';
  end if;
  if exists (select 1 from fallas_foto_reporte where falla_id = p_falla_id) then
    raise exception 'Esta falla ya tiene su foto del reporte';
  end if;
  insert into fallas_foto_reporte (falla_id, ruta, bytes, subido_por) values (p_falla_id, p_ruta, p_bytes, auth.uid()) returning id into v_id;
  return v_id;
end $function$;
revoke all on function public.registrar_foto_reporte(uuid, text, integer) from public, anon;
grant execute on function public.registrar_foto_reporte(uuid, text, integer) to authenticated;

-- Subida al almacenamiento: quien informa puede subir a la carpeta de una falla creada por él
drop policy if exists fotos_rep_insert_reporte on storage.objects;
create policy fotos_rep_insert_reporte on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fotos-reparacion'
    and (select public.tiene_permiso('informar_falla'))
    and exists (select 1 from public.fallas f
                where f.id::text = (storage.foldername(name))[1] and f.creado_por = auth.uid())
  );
