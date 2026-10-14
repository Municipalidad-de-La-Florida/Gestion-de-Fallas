-- =====================================================================
-- Armar una inspección con fallas sueltas (solo administrador)
-- ---------------------------------------------------------------------
-- Caso: un ITO ingresó fallas con «Agregar falla» y no creó la inspección del día.
-- Dos funciones, ambas SOLO para el rol admin:
--   fallas_sueltas_ito(p_ito, p_fecha, p_dias)  → lista las fallas del ITO que no pertenecen a ninguna
--                                                 inspección, en una ventana de ±p_dias alrededor de la fecha.
--   asignar_fallas_a_inspeccion(p_ito, p_fecha, p_fallas) → crea (o reutiliza) la inspección de ese ITO
--                                                 en esa fecha y le asocia las fallas elegidas
--                                                 (y los puntos en cascada de las fallas de circuito).
-- No cambia la fecha ni el estado de ninguna falla, ni quién la ingresó.
-- Solo toma fallas que hoy NO tienen inspección. No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================

create or replace function public.fallas_sueltas_ito(p_ito uuid, p_fecha date, p_dias integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede usar esta herramienta.';
  end if;
  return coalesce((
    select jsonb_agg(x.o order by x.fi, x.ot) from (
      select f.fecha_falla_real as fi, f.ot as ot, jsonb_build_object(
        'id', f.id, 'ot', f.ot, 'tipo', f.tipo, 'tipo_falla', f.tipo_falla, 'estado', f.estado,
        'fecha_ingreso', f.fecha_falla_real,
        'dia', (f.fecha_falla_real at time zone 'America/Santiago')::date,
        'mismo_dia', (f.fecha_falla_real at time zone 'America/Santiago')::date = p_fecha,
        'llave', p.llave, 'nro_mun', p.nro_mun,
        'direccion', nullif(concat_ws(' ', p.calle_1, p.direccion), ''),
        'simb_poste', p.simb_poste,
        'circuito_id', c.id,
        'puntos_afectados', case when f.tipo = 'linea'
            then (select count(*) from public.fallas fc where fc.circuito_origen_id = f.id) else 1 end
      ) as o
      from public.fallas f
      left join public.puntos_luminarios p on f.tipo = 'punto' and p.gid = f.ref_punto_gid
      left join public.circuitos c        on f.tipo = 'linea' and c.gid = f.ref_circuito_gid
      where f.cascada = false
        and f.inspeccion_id is null
        and (f.creado_por = p_ito or f.informado_por = p_ito)
        and abs(((f.fecha_falla_real at time zone 'America/Santiago')::date) - p_fecha) <= greatest(coalesce(p_dias, 7), 0)
    ) x
  ), '[]'::jsonb);
end $$;
revoke all on function public.fallas_sueltas_ito(uuid, date, integer) from public, anon;
grant execute on function public.fallas_sueltas_ito(uuid, date, integer) to authenticated;

create or replace function public.asignar_fallas_a_inspeccion(p_ito uuid, p_fecha date, p_fallas uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_creada boolean := false; v_n integer; v_c integer;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
begin
  if public.mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede usar esta herramienta.';
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'La fecha de la inspección no puede ser futura.';
  end if;
  if p_fallas is null or coalesce(array_length(p_fallas, 1), 0) = 0 then
    raise exception 'No hay fallas seleccionadas.';
  end if;
  if not exists (select 1 from public.usuarios where id = p_ito and rol in ('ito', 'ito2')) then
    raise exception 'El usuario elegido no es un ITO.';
  end if;

  select id into v_id from public.inspecciones where ito_id = p_ito and fecha = p_fecha;
  if v_id is null then
    insert into public.inspecciones (fecha, ito_id, creado_por) values (p_fecha, p_ito, auth.uid())
    on conflict (ito_id, fecha) do update set ito_id = excluded.ito_id
    returning id into v_id;
    v_creada := true;
  end if;

  -- Solo fallas sin inspección y del ITO elegido (nunca mueve una falla que ya está en otra)
  update public.fallas
     set inspeccion_id = v_id
   where id = any(p_fallas) and cascada = false and inspeccion_id is null
     and (creado_por = p_ito or informado_por = p_ito);   -- solo fallas de ese ITO
  get diagnostics v_n = row_count;

  -- Los puntos en cascada de las fallas de circuito quedan en la misma inspección
  update public.fallas
     set inspeccion_id = v_id
   where inspeccion_id is null
     and circuito_origen_id in (select id from public.fallas where id = any(p_fallas) and inspeccion_id = v_id);
  get diagnostics v_c = row_count;

  return jsonb_build_object('inspeccion_id', v_id, 'creada', v_creada, 'fallas', v_n, 'cascada', v_c,
                            'omitidas', coalesce(array_length(p_fallas, 1), 0) - v_n);
end $$;
revoke all on function public.asignar_fallas_a_inspeccion(uuid, date, uuid[]) from public, anon;
grant execute on function public.asignar_fallas_a_inspeccion(uuid, date, uuid[]) to authenticated;

-- Comprobación: debe devolver 2 filas
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('fallas_sueltas_ito', 'asignar_fallas_a_inspeccion') order by proname;
