-- Fallas de lo que antes era Elecnor/Clever y desde el 1-nov-2026 es Elecnor/Sinec: nacen marcadas como MASIVO.
-- La lista de puntos y circuitos "ex Clever" se guarda en tablas aparte (no en luminarias/circuitos), para que
-- sobreviva a cualquier recarga de capas. Para dejar de marcar: delete from ex_clever_puntos; delete from ex_clever_circuitos;
-- (o deshabilitar el trigger trg_y_masivo_ex_clever).
-- Solo marca fallas cuyo mantenedor derivado sea Sinec con contrato Elecnor Y cuyo punto/circuito esté en la lista:
-- mientras siga siendo Clever (antes del cambio) o si es una luminaria que ya era Elecnor/Sinec, no se marca nada.

create table if not exists public.ex_clever_puntos (llave integer not null, uso_grupo text not null, primary key (llave, uso_grupo));
create table if not exists public.ex_clever_circuitos (gid integer primary key);
alter table public.ex_clever_puntos enable row level security;
alter table public.ex_clever_circuitos enable row level security;

-- Foto de lo que hoy es Elecnor/Clever (ejecutar ANTES del cambio del 1 de noviembre)
insert into public.ex_clever_puntos (llave, uso_grupo)
  select distinct l.llave, coalesce(l.uso_grupo, 'OTRO') from public.luminarias l
   where upper(btrim(l.contrato)) = 'ELECNOR' and upper(btrim(l.mantenedor)) = 'CLEVER' and l.llave is not null
  on conflict do nothing;
insert into public.ex_clever_circuitos (gid)
  select c.gid from public.circuitos c where upper(btrim(c.contrato)) = 'ELECNOR' and upper(btrim(c.mantenedor)) = 'CLEVER'
  on conflict do nothing;

create or replace function public.marcar_masivo_ex_clever(f fallas)
returns fallas language plpgsql security definer set search_path to 'public'
as $function$
declare v_ok boolean := false; v_llave integer;
begin
  if coalesce(f.masivo, false) then return f; end if;
  if coalesce(f.cascada, false) then
    select coalesce(o.masivo, false) into f.masivo from public.fallas o where o.id = f.circuito_origen_id;
    f.masivo := coalesce(f.masivo, false);
    return f;
  end if;
  if f.contrato_id is null or f.mantenedor_id is null then return f; end if;
  if not exists (select 1 from public.contratos c, public.mantenedores m
                  where c.id = f.contrato_id and m.id = f.mantenedor_id and upper(btrim(c.nombre)) = 'ELECNOR' and upper(btrim(m.nombre)) = 'SINEC') then
    return f;
  end if;
  if f.ref_punto_gid is not null then
    select p.llave into v_llave from public.puntos_luminarios p where p.gid = f.ref_punto_gid;
    v_ok := exists (select 1 from public.ex_clever_puntos e where e.llave = v_llave and (f.uso_grupo is null or e.uso_grupo = f.uso_grupo));
  elsif f.ref_circuito_gid is not null then
    v_ok := exists (select 1 from public.ex_clever_circuitos e where e.gid = f.ref_circuito_gid);
  end if;
  if v_ok then f.masivo := true; end if;
  return f;
end $function$;
revoke all on function public.marcar_masivo_ex_clever(fallas) from public, anon, authenticated;

create or replace function public.fn_masivo_ex_clever() returns trigger
language plpgsql security definer set search_path to 'public'
as $function$ begin new := public.marcar_masivo_ex_clever(new); return new; end $function$;

-- Corre después de la derivación (trg_derivar_...) y antes del contrato por defecto (trg_z_...)
drop trigger if exists trg_y_masivo_ex_clever on public.fallas;
create trigger trg_y_masivo_ex_clever before insert on public.fallas for each row execute function public.fn_masivo_ex_clever();
