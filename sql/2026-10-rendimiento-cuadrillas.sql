-- Rendimiento de cuadrillas (camiones): herramienta web que muestra, por turno, con cuántas fallas
-- comenzó una cuadrilla, cuántas se le asignaron, cuántas reparó, dejó pendientes o sin atender.
-- 1) Permiso por usuario (lo habilita el administrador en Gestión de usuarios → Cuadrillas).
-- 2) Historial de asignaciones (para que los números sean exactos desde ahora; lo anterior se reconstruye
--    con la última asignación de cada falla).
-- 3) Función rendimiento_cuadrillas(desde, hasta), solo admin o usuarios habilitados.
-- Se puede ejecutar más de una vez.

alter table public.usuarios add column if not exists ver_cuadrillas boolean not null default false;

create table if not exists public.asignaciones_historial (
  id bigserial primary key,
  falla_id uuid not null references public.fallas(id) on delete cascade,
  camion_id uuid not null references public.usuarios(id) on delete cascade,
  asignado_en timestamptz not null default now(),
  asignado_por uuid,
  quitado_en timestamptz
);
create index if not exists asignaciones_historial_falla_idx on public.asignaciones_historial (falla_id);
create index if not exists asignaciones_historial_camion_idx on public.asignaciones_historial (camion_id, asignado_en);
alter table public.asignaciones_historial enable row level security;
-- Sin políticas: solo se lee con la función de abajo y solo la escriben los triggers.

create or replace function public.registrar_asignacion_historial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cascada is true then return new; end if;   -- las hijas de un circuito heredan: se cuenta solo la falla principal
  if tg_op = 'UPDATE' then
    if old.asignado_camion_id is not distinct from new.asignado_camion_id then return new; end if;
    update public.asignaciones_historial set quitado_en = now()
    where falla_id = new.id and quitado_en is null;
  end if;
  if new.asignado_camion_id is not null then
    insert into public.asignaciones_historial (falla_id, camion_id, asignado_en, asignado_por)
    values (new.id, new.asignado_camion_id, coalesce(new.fecha_asignacion, now()), new.asignado_por_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_registrar_asignacion_historial on public.fallas;
create trigger trg_registrar_asignacion_historial
after insert or update of asignado_camion_id on public.fallas
for each row execute function public.registrar_asignacion_historial();

-- Reconstrucción de lo anterior: una fila por falla asignada hoy (con su fecha de asignación)
insert into public.asignaciones_historial (falla_id, camion_id, asignado_en, asignado_por)
select f.id, f.asignado_camion_id, coalesce(f.fecha_asignacion, f.fecha_falla), f.asignado_por_id
from public.fallas f
where f.asignado_camion_id is not null and f.cascada is not true
  and not exists (select 1 from public.asignaciones_historial h where h.falla_id = f.id);

create or replace function public.rendimiento_cuadrillas(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.mi_rol() = 'admin'
          or coalesce((select ver_cuadrillas from public.usuarios where id = auth.uid()), false)) then
    raise exception 'No tienes permiso para ver el rendimiento de cuadrillas';
  end if;
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then raise exception 'Rango de fechas inválido'; end if;

  return jsonb_build_object(
    'cuadrillas', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.nombre)
      from public.usuarios u where u.rol = 'camion' and u.nombre not ilike 'zzz%'), '[]'::jsonb),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'camion_id', h.camion_id,
        'falla_id', f.id,
        'ot', f.ot,
        'tipo', f.tipo,
        'tipo_falla', f.tipo_falla,
        'direccion', coalesce(nullif(concat_ws(' ', p.calle_1, p.direccion), ''), case when f.tipo = 'linea' then 'Circuito ' || f.ref_circuito_gid end),
        'geom', coalesce(ST_AsGeoJSON(p.geom)::jsonb, ST_AsGeoJSON(c.geom)::jsonb),
        'asignado_en', h.asignado_en,
        'quitado_en', h.quitado_en,
        'reparada_en', r.fecha_reparacion,
        'reparado_por', r.reparado_por,
        'reparado_por_rol', ur.rol,
        'pendiente_por_rol', up.rol,
        'estado', f.estado,
        'fecha_pendiente', f.fecha_pendiente,
        'motivo_pendiente', f.motivo_pendiente
      ) order by h.asignado_en)
      from public.asignaciones_historial h
      join public.usuarios u on u.id = h.camion_id and u.rol = 'camion' and u.nombre not ilike 'zzz%'
      join public.fallas f on f.id = h.falla_id and f.cascada is not true
      left join public.puntos_luminarios p on f.tipo = 'punto' and p.gid = f.ref_punto_gid
      left join public.circuitos c on f.tipo = 'linea' and c.gid = f.ref_circuito_gid
      left join lateral (
        select r2.fecha_reparacion, r2.reparado_por from public.reparaciones r2
        where r2.falla_id = f.id and r2.fecha_reparacion >= h.asignado_en
        order by r2.fecha_reparacion asc limit 1
      ) r on true
      left join public.usuarios ur on ur.id = r.reparado_por
      left join public.usuarios up on up.id = f.pendiente_por
      where h.asignado_en < p_hasta
        -- si la falla se reasignó a otra cuadrilla sin que esta la reparara, no cuenta para ella
        and not (h.quitado_en is not null and h.quitado_en < p_hasta
                 and (r.fecha_reparacion is null or r.fecha_reparacion > h.quitado_en))
        -- si ya estaba reparada antes de empezar el turno, tampoco
        and (r.fecha_reparacion is null or r.fecha_reparacion >= p_desde)
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.rendimiento_cuadrillas(timestamptz, timestamptz) from public;
grant execute on function public.rendimiento_cuadrillas(timestamptz, timestamptz) to authenticated;
