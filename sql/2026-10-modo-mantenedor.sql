-- Indica si el usuario ve el mapa en "modo mantenedor": camiones y contratistas por mantenedor (Sinec, Clever).
-- Para ellos las fallas atrasadas no se pintan rojas: parpadean en su color (reportada amarilla, pendiente celeste, reiterada morada).
create or replace function public.es_usuario_mantenedor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol(), '') = 'camion'
      or (coalesce(public.mi_rol(), '') in ('contratista', 'contratista2', 'contratista3')
          and exists (select 1 from public.usuario_mantenedores um where um.usuario_id = auth.uid()));
$$;
revoke all on function public.es_usuario_mantenedor() from public, anon;
grant execute on function public.es_usuario_mantenedor() to authenticated;
