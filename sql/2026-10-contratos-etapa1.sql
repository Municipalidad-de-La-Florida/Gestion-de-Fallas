-- Contratos, etapa 1: catálogo de contratos y su relación con los usuarios.
-- NO restringe nada todavía: solo crea las tablas y deja a quién pertenece cada usuario.
-- Es seguro ejecutarlo antes de publicar el cambio del index.html (no toca fallas ni funciones existentes).

create table if not exists public.contratos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create unique index if not exists contratos_nombre_uq on public.contratos (lower(btrim(nombre)));

-- Un usuario puede pertenecer a varios contratos.
create table if not exists public.usuario_contratos (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  primary key (usuario_id, contrato_id)
);
create index if not exists usuario_contratos_contrato_idx on public.usuario_contratos (contrato_id);

alter table public.contratos enable row level security;
alter table public.usuario_contratos enable row level security;

drop policy if exists contratos_select on public.contratos;
create policy contratos_select on public.contratos for select to authenticated using (true);
drop policy if exists contratos_admin_insert on public.contratos;
create policy contratos_admin_insert on public.contratos for insert to authenticated with check (public.mi_rol() = 'admin');
drop policy if exists contratos_admin_update on public.contratos;
create policy contratos_admin_update on public.contratos for update to authenticated using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

-- Cada usuario ve sus propios contratos; el admin ve todos. Los cambios se hacen solo con la función de abajo.
drop policy if exists usuario_contratos_select on public.usuario_contratos;
create policy usuario_contratos_select on public.usuario_contratos for select to authenticated
  using (public.mi_rol() = 'admin' or usuario_id = auth.uid());

revoke all on public.contratos, public.usuario_contratos from anon;
revoke insert, update, delete on public.usuario_contratos from authenticated;

-- Reemplaza la lista de contratos de un usuario (solo admin).
create or replace function public.set_contratos_usuario(p_usuario uuid, p_contratos uuid[])
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if public.mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede asignar contratos.';
  end if;
  delete from public.usuario_contratos
   where usuario_id = p_usuario
     and (p_contratos is null or contrato_id <> all(p_contratos));
  insert into public.usuario_contratos (usuario_id, contrato_id)
    select p_usuario, c.id from public.contratos c
    where p_contratos is not null and c.id = any(p_contratos)
  on conflict do nothing;
end;
$function$;
revoke all on function public.set_contratos_usuario(uuid, uuid[]) from public, anon;
grant execute on function public.set_contratos_usuario(uuid, uuid[]) to authenticated;

-- Contratos actuales (puedes crear más desde 👥 Usuarios → Contratos).
insert into public.contratos (nombre) values ('Enel X - Clever'), ('Elecnor')
on conflict do nothing;
