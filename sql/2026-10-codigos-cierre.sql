-- Códigos de cierre con su grupo (equipo, red, infraestructura…) y análisis de cierres para el informe PDF.
-- Para agregar un código nuevo basta insertar una fila en public.codigos_cierre (ver el final de este archivo).

create table if not exists public.codigos_cierre (
  codigo      text primary key check (codigo ~ '^[0-9]{3}$'),
  descripcion text not null,
  grupo       text not null default 'Otros',
  activo      boolean not null default true
);

alter table public.codigos_cierre enable row level security;

drop policy if exists codigos_cierre_select on public.codigos_cierre;
create policy codigos_cierre_select on public.codigos_cierre for select to authenticated using (true);

drop policy if exists codigos_cierre_admin on public.codigos_cierre;
create policy codigos_cierre_admin on public.codigos_cierre for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'));

insert into public.codigos_cierre (codigo, descripcion, grupo) values
  ('001', 'Cambio de lámpara quemada', 'Equipo de la luminaria'),
  ('011', 'Cambio de Ballast o Driver', 'Equipo de la luminaria'),
  ('047', 'Cambio de porta CFE', 'Equipo de la luminaria'),
  ('052', 'Cambio de Ignitor', 'Equipo de la luminaria'),
  ('126', 'Cambio de lámpara agotada', 'Equipo de la luminaria'),
  ('012', 'Cambio de CFE dañada', 'Red y conexiones'),
  ('013', 'Cambio de CFE averiada', 'Red y conexiones'),
  ('026', 'Reparación de conexión', 'Red y conexiones'),
  ('054', 'Falla subterránea', 'Red y conexiones'),
  ('129', 'Apriete CFE suelta', 'Red y conexiones'),
  ('037', 'Cambio de contactor dañado', 'Tablero y protecciones'),
  ('130', 'Automático operado', 'Tablero y protecciones'),
  ('131', 'Automático operado por 3eros', 'Tablero y protecciones'),
  ('072', 'Normalización de luminaria o gancho virado', 'Infraestructura'),
  ('009', 'Luminaria en funcionamiento normal', 'Funcionamiento normal'),
  ('041', 'Circuito en funcionamiento normal', 'Funcionamiento normal'),
  ('999', 'Otros', 'Otros')
on conflict (codigo) do nothing;

-- Cierres del período: mismos filtros que analisis_fallas. Se cuenta el código que aparece al inicio de cada línea de la
-- descripción de la última reparación ("130 Automático operado", "Cierre 26"); solo cuentan los códigos del catálogo.
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

-- Ejemplo para agregar un código nuevo más adelante:
-- insert into public.codigos_cierre (codigo, descripcion, grupo) values ('140', 'Descripción del cierre', 'Red y conexiones');

-- Comprobación:
select grupo, count(*) as codigos from public.codigos_cierre group by grupo order by grupo;
