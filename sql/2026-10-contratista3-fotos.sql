-- Contratista3 no podía adjuntar fotos: la política del Storage (bucket fotos-reparacion)
-- no incluía el rol. (El script del perfil solo cubría el esquema public.)
drop policy if exists fotos_rep_insert on storage.objects;
create policy fotos_rep_insert on storage.objects for insert to public
  with check (
    bucket_id = 'fotos-reparacion'
    and exists (select 1 from public.usuarios u
                where u.id = auth.uid()
                  and u.rol = any (array['admin','contratista','contratista2','contratista3','camion']))
  );
