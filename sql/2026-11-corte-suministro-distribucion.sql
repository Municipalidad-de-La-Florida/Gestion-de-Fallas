-- Cierre "Cortado Suministro Distribución" (ya aplicado en Supabase como migración corte_suministro_distribucion)
-- Marca el circuito (por n.° de cliente) hasta que un admin lo restablezca.
alter table public.codigos_cierre add column if not exists corte boolean not null default false;
insert into public.codigos_cierre (codigo, descripcion, orden, activo, corte)
values ('900', 'Cortado Suministro Distribución', 0, true, true)
on conflict (codigo) do update set descripcion = excluded.descripcion, orden = 0, activo = true, corte = true;

create table if not exists public.circuitos_corte (
  id uuid primary key default gen_random_uuid(),
  n_cliente text not null,
  circuito_gid integer,
  falla_id uuid,
  desde timestamptz not null default now(),
  por uuid,
  activo boolean not null default true,
  restablecido_en timestamptz,
  restablecido_por uuid,
  nota text
);
create unique index if not exists circuitos_corte_activo_uq on public.circuitos_corte (n_cliente) where activo;
alter table public.circuitos_corte enable row level security;
drop policy if exists circuitos_corte_select on public.circuitos_corte;
create policy circuitos_corte_select on public.circuitos_corte for select to authenticated using (true);
revoke all on public.circuitos_corte from anon, public;
grant select on public.circuitos_corte to authenticated;

create or replace function public._reparacion_marca_corte() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.fallas%rowtype; v_cli text; v_gid integer;
begin
  if not exists (select 1 from public.codigos_cierre c where c.corte and position(c.codigo || ' ' || c.descripcion in new.descripcion) > 0) then
    return new;
  end if;
  select * into f from public.fallas where id = new.falla_id;
  if not found then return new; end if;
  if f.ref_circuito_gid is not null then
    v_gid := f.ref_circuito_gid;
    select nullif(btrim(n_cliente), '') into v_cli from public.circuitos where gid = v_gid;
  elsif f.ref_punto_gid is not null then
    select nullif(btrim(n_cliente), '') into v_cli from public.puntos_luminarios where gid = f.ref_punto_gid;
    select gid into v_gid from public.circuitos where v_cli is not null and btrim(n_cliente) = v_cli order by gid limit 1;
  end if;
  if v_cli is null then return new; end if;
  insert into public.circuitos_corte (n_cliente, circuito_gid, falla_id, por) values (v_cli, v_gid, new.falla_id, new.reparado_por)
  on conflict (n_cliente) where activo do nothing;
  return new;
end $$;
drop trigger if exists trg_reparacion_marca_corte on public.reparaciones;
create trigger trg_reparacion_marca_corte after insert on public.reparaciones for each row execute function public._reparacion_marca_corte();

create or replace function public.cortes_activos() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('n_cliente', c.n_cliente, 'circuito_gid', c.circuito_gid, 'desde', c.desde,
           'por', (select u.nombre from public.usuarios u where u.id = c.por)) order by c.desde desc), '[]'::jsonb)
  from public.circuitos_corte c where c.activo and auth.uid() is not null $$;

create or replace function public.corte_restablecer(p_n_cliente text, p_nota text default null) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin') then
    raise exception 'Solo un administrador puede restablecer el suministro';
  end if;
  update public.circuitos_corte set activo = false, restablecido_en = now(), restablecido_por = auth.uid(), nota = nullif(btrim(p_nota), '')
   where activo and n_cliente = p_n_cliente;
  return found;
end $$;
revoke all on function public.cortes_activos() from public, anon;
revoke all on function public.corte_restablecer(text, text) from public, anon;
grant execute on function public.cortes_activos() to authenticated;
grant execute on function public.corte_restablecer(text, text) to authenticated;

-- Tag #EnCorte (migración corte_tag_encorte): fallas cerradas con el código de corte y fallas activas de circuitos cortados.
-- cortes_fallas() devuelve sus ids; resumen_todas_fallas (búsqueda de la web) entiende "EnCorte" / "#EnCorte".
-- Ver la definición vigente de ambas funciones en la base.

-- Renombre (migración corte_desde_la_distribucion): el código 900 pasa a "Cortado desde la Distribución" y el trigger
-- reconoce el corte por el código al inicio de una línea (no por el nombre), para no depender de nombres guardados en celulares.
update public.codigos_cierre set descripcion = 'Cortado desde la Distribución' where codigo = '900' and corte;

-- Si se edita la descripción de un cierre y pasa a incluir el código de corte, también se marca el circuito
drop trigger if exists trg_reparacion_marca_corte_upd on public.reparaciones;
create trigger trg_reparacion_marca_corte_upd after update of descripcion on public.reparaciones for each row when (old.descripcion is distinct from new.descripcion) execute function public._reparacion_marca_corte();
-- Tag #EnCorte también para fallas cuya reparación o motivo de pendiente dicen «corte de suministro»
create or replace function public._falla_texto_corte(p_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.reparaciones r where r.falla_id = p_id and r.descripcion ~* 'corte de suministro')
      or exists (select 1 from public.fallas f where f.id = p_id and (f.motivo_pendiente ~* 'corte de suministro' or f.descripcion_otro ~* 'corte de suministro'))
$$;
revoke all on function public._falla_texto_corte(uuid) from public, anon;
-- cortes_fallas() = (fallas de circuitos cortados o cerradas con 900) UNION (fallas con ese texto)
-- resumen_todas_fallas: la columna de búsqueda '#encorte encorte' también usa _falla_texto_corte(f.id)
-- cortes_activos() incluye falla_id (la falla cerrada con 900): el mapa no la pinta verde mientras el corte siga activo
create or replace function public.cortes_activos() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('n_cliente', c.n_cliente, 'circuito_gid', c.circuito_gid, 'desde', c.desde, 'falla_id', c.falla_id,
           'por', (select u.nombre from public.usuarios u where u.id = c.por)) order by c.desde desc), '[]'::jsonb)
  from public.circuitos_corte c where c.activo and auth.uid() is not null $$;
