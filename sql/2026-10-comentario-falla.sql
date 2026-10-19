-- Comentarios sobre una falla ya creada (sin cerrarla ni editarla).
-- Agrega el tipo 'comentario' a fallas_comentarios y deja que lo escriban los perfiles que ven la falla (todos menos observador).
-- Se puede ejecutar más de una vez.

alter table public.fallas_comentarios drop constraint if exists fallas_comentarios_tipo_check;
alter table public.fallas_comentarios add constraint fallas_comentarios_tipo_check
  check (tipo = any (array['reporte','asignacion','pendiente','reparacion','masivo','comentario']));

drop policy if exists insertar_comentarios_fallas on public.fallas_comentarios;
create policy insertar_comentarios_fallas on public.fallas_comentarios
  for insert to authenticated
  with check (
    autor_id = (select auth.uid())
    and exists (
      select 1 from public.usuarios u
      where u.id = (select auth.uid())
        and (
          (fallas_comentarios.tipo in ('reporte','masivo') and u.rol in ('ito','ito2','contratista2','contratista3','admin'))
          or (fallas_comentarios.tipo = 'asignacion' and u.rol in ('contratista','contratista2','contratista3','admin'))
          or (fallas_comentarios.tipo in ('pendiente','reparacion') and u.rol in ('contratista','contratista2','contratista3','camion','admin'))
          or (fallas_comentarios.tipo = 'comentario' and u.rol in ('admin','ito','ito2','contratista','contratista2','contratista3','camion'))
        )
    )
  );
