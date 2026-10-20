-- LIBRERÍA: códigos de falla y de cierre editables desde la web (sin tocar SQL cada vez).
-- Se puede ejecutar más de una vez: no pisa lo que ya editaste.

-- ============ 1) Códigos de falla (puntos, monopostes y circuitos) ============
create table if not exists public.codigos_falla (
  categoria   text not null check (categoria in ('punto', 'monoposte', 'circuito')),
  codigo      text not null check (length(codigo) between 1 and 12),
  descripcion text not null check (length(descripcion) between 1 and 120),
  orden       integer not null default 0,
  activo      boolean not null default true,
  primary key (categoria, codigo)
);

-- ============ 2) Códigos de cierre (con grupo) ============
create table if not exists public.codigos_cierre (
  codigo      text primary key check (codigo ~ '^[0-9]{3}$'),
  descripcion text not null check (length(descripcion) between 1 and 120),
  grupo       text not null default 'Otros',
  orden       integer not null default 0,
  activo      boolean not null default true
);
alter table public.codigos_cierre add column if not exists orden integer not null default 0;

-- ============ 3) Permisos: todos leen, solo el admin modifica ============
alter table public.codigos_falla  enable row level security;
alter table public.codigos_cierre enable row level security;

drop policy if exists codigos_falla_select on public.codigos_falla;
create policy codigos_falla_select on public.codigos_falla for select to authenticated using (true);
drop policy if exists codigos_falla_admin on public.codigos_falla;
create policy codigos_falla_admin on public.codigos_falla for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'));

drop policy if exists codigos_cierre_select on public.codigos_cierre;
create policy codigos_cierre_select on public.codigos_cierre for select to authenticated using (true);
drop policy if exists codigos_cierre_admin on public.codigos_cierre;
create policy codigos_cierre_admin on public.codigos_cierre for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'));

-- ============ 4) Datos iniciales (los que hoy están fijos en la web y la app) ============
insert into public.codigos_falla (categoria, codigo, descripcion, orden) values
  ('punto', 'F01', 'Luminaria vial apagada', 1),
  ('punto', 'F04', 'Luminaria vial encendida de día', 2),
  ('punto', 'F05', 'Luminaria vial intermitente', 3),
  ('punto', 'F22', 'Luminaria agotada o tenue', 4),
  ('punto', 'F23', 'Luminaria virada - gancho virado', 5),
  ('punto', 'F29', 'Luminaria peatonal apagada', 6),
  ('punto', 'F32', 'Luminaria peatonal encendida de día', 7),
  ('punto', 'F33', 'Luminaria peatonal intermitente', 8),
  ('punto', 'F35', 'Aplomar poste', 9),
  ('punto', 'F38', 'Luminaria faltante', 10),
  ('punto', 'F43', 'Dos luminarias apagadas', 11),
  ('punto', 'OTRO', 'Otro (describe la falla)', 99),
  ('monoposte', 'F02', 'Monoposte apagado', 1),
  ('monoposte', 'F03', 'Monoposte encendido de día', 2),
  ('monoposte', 'OTRO', 'Otro (describe la falla)', 99),
  ('circuito', 'F02', 'Circuito vial apagado', 1),
  ('circuito', 'F03', 'Circuito vial encendido de día', 2),
  ('circuito', 'F30', 'Circuito peatonal apagado', 3),
  ('circuito', 'F31', 'Circuito peatonal encendido de día', 4),
  ('circuito', 'F45', 'Circuito vial intermitente', 5),
  ('circuito', 'F46', 'Circuito peatonal intermitente', 6),
  ('circuito', 'OTRO', 'Otro (describe la falla)', 99)
on conflict (categoria, codigo) do nothing;

insert into public.codigos_cierre (codigo, descripcion, grupo, orden) values
  ('001', 'Cambio de lámpara quemada', 'Equipo de la luminaria', 1),
  ('009', 'Luminaria en funcionamiento normal', 'Funcionamiento normal', 2),
  ('011', 'Cambio de Ballast o Driver', 'Equipo de la luminaria', 3),
  ('012', 'Cambio de CFE dañada', 'Red y conexiones', 4),
  ('013', 'Cambio de CFE averiada', 'Red y conexiones', 5),
  ('026', 'Reparación de conexión', 'Red y conexiones', 6),
  ('037', 'Cambio de contactor dañado', 'Tablero y protecciones', 7),
  ('041', 'Circuito en funcionamiento normal', 'Funcionamiento normal', 8),
  ('047', 'Cambio de porta CFE', 'Equipo de la luminaria', 9),
  ('052', 'Cambio de Ignitor', 'Equipo de la luminaria', 10),
  ('054', 'Falla subterránea', 'Red y conexiones', 11),
  ('072', 'Normalización de luminaria o gancho virado', 'Infraestructura', 12),
  ('126', 'Cambio de lámpara agotada', 'Equipo de la luminaria', 13),
  ('129', 'Apriete CFE suelta', 'Red y conexiones', 14),
  ('130', 'Automático operado', 'Tablero y protecciones', 15),
  ('131', 'Automático operado por 3eros', 'Tablero y protecciones', 16),
  ('999', 'Otros', 'Otros', 99)
on conflict (codigo) do nothing;

-- Si ya habías creado codigos_cierre antes (sin orden), se ordena según su código
update public.codigos_cierre set orden = codigo::int where orden = 0;

-- ============ 5) Cierres del período para el informe PDF ============
-- Mismos filtros que analisis_fallas. Se cuenta el código que aparece al inicio de cada línea de la descripción
-- de la última reparación ("130 Automático operado", "Cierre 26"); solo cuentan los códigos del catálogo.
create or replace function public.analisis_cierres(
  p_inicio date, p_fin date, p_medir text default 'informada', p_masivo boolean default null,
  p_asignadores uuid[] default null, p_ito uuid default null, p_contratos uuid[] default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ini timestamptz;
  v_fin timestamptz;
  v jsonb;
begin
  if not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol in ('admin','ito','ito2')) then
    return null;
  end if;
  if p_inicio is null or p_fin is null or p_inicio > p_fin then
    raise exception 'Rango de fechas inválido';
  end if;
  if p_fin - p_inicio > 400 then
    raise exception 'El rango no puede superar 400 días';
  end if;
  v_ini := p_inicio::timestamp at time zone 'America/Santiago';
  v_fin := (p_fin + 1)::timestamp at time zone 'America/Santiago';

  with base as materialized (
    select f.id, r.descripcion
    from public.fallas f
    join lateral (
      select r2.descripcion, r2.fecha_reparacion
      from public.reparaciones r2
      where r2.falla_id = f.id
      order by r2.fecha_reparacion desc
      limit 1
    ) r on true
    where f.cascada = false
      and (p_masivo is null or coalesce(f.masivo, false) = p_masivo)
      and (p_contratos is null or f.contrato_id = any(p_contratos))
      and (p_asignadores is null or f.asignado_por_id = any(p_asignadores))
      and (p_ito is null or coalesce(f.notificador_id, f.informado_por, f.creado_por) = p_ito)
      and (
        case when p_medir = 'reparacion'
          then r.fecha_reparacion >= v_ini and r.fecha_reparacion < v_fin
          else f.fecha_falla >= v_ini and f.fecha_falla < v_fin end
      )
  ),
  lineas as (
    select b.id, lpad(coalesce(m[1], m[2]), 3, '0') as codigo
    from base b
    cross join lateral unnest(string_to_array(coalesce(b.descripcion, ''), E'\n')) as l
    cross join lateral (select regexp_match(l, '^\s*(?:cierre\s+([0-9]{1,3})|([0-9]{3}))(?![0-9])', 'i') as m) x
    where m is not null
  ),
  cods as (
    select distinct l.id, l.codigo, c.descripcion, c.grupo
    from lineas l join public.codigos_cierre c on c.codigo = l.codigo
  )
  select jsonb_build_object(
    'total_reparadas', (select count(*) from base),
    'con_codigo', (select count(distinct id) from cods),
    'por_codigo', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', codigo, 'descripcion', descripcion, 'grupo', grupo, 'veces', n) order by n desc, codigo)
      from (select codigo, descripcion, grupo, count(*) n from cods group by 1, 2, 3) q
    ), '[]'::jsonb),
    'por_grupo', coalesce((
      select jsonb_agg(jsonb_build_object('grupo', grupo, 'veces', n) order by n desc, grupo)
      from (select grupo, count(*) n from cods group by 1) q
    ), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
grant execute on function public.analisis_cierres(date, date, text, boolean, uuid[], uuid, uuid[]) to authenticated;

-- ============ 6) Códigos más usados (para mostrar primero los 6 más frecuentes) ============
-- Mira los últimos p_dias días. Devuelve, por categoría, los códigos ordenados de más a menos usados.
create or replace function public.codigos_frecuentes(p_dias integer default 90)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  with f as (
    select case when tipo = 'linea' then 'circuito'
                when tipo_falla in ('F02', 'F03') then 'monoposte'
                else 'punto' end as categoria,
           tipo_falla as codigo
    from public.fallas
    where cascada = false and fecha_falla >= now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 400)))
      and tipo_falla is not null
  ),
  fc as (select categoria, codigo, count(*) n from f group by 1, 2),
  lin as (
    select lpad(coalesce(m[1], m[2]), 3, '0') as codigo
    from public.reparaciones r
    cross join lateral unnest(string_to_array(coalesce(r.descripcion, ''), E'\n')) as l
    cross join lateral (select regexp_match(l, '^\s*(?:cierre\s+([0-9]{1,3})|([0-9]{3}))(?![0-9])', 'i') as m) x
    where r.fecha_reparacion >= now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 400))) and m is not null
  ),
  cc as (select codigo, count(*) n from lin group by 1)
  select jsonb_build_object(
    'punto',     coalesce((select jsonb_agg(codigo order by n desc, codigo) from fc where categoria = 'punto'), '[]'::jsonb),
    'monoposte', coalesce((select jsonb_agg(codigo order by n desc, codigo) from fc where categoria = 'monoposte'), '[]'::jsonb),
    'circuito',  coalesce((select jsonb_agg(codigo order by n desc, codigo) from fc where categoria = 'circuito'), '[]'::jsonb),
    'cierre',    coalesce((select jsonb_agg(codigo order by n desc, codigo) from cc), '[]'::jsonb)
  );
$$;
grant execute on function public.codigos_frecuentes(integer) to authenticated;

-- Comprobación: debe mostrar 22 códigos de falla (12 + 3 + 7) y 17 de cierre
select (select count(*) from public.codigos_falla) as codigos_falla,
       (select count(*) from public.codigos_cierre) as codigos_cierre,
       public.codigos_frecuentes(90) as frecuentes;
