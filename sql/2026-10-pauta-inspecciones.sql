-- Pauta de inspecciones por ITO: cada ITO solo puede ingresar inspecciones en sus días de la semana y
-- una inspección se cierra sola 4 horas después de iniciada. Los demás días solo puede usar «Agregar falla».
-- Aplica solo al rol 'ito' (ito2 y admin no tienen restricción). Los ITO nuevos quedan SIN días hasta que el
-- administrador los habilite en Gestión de usuarios → «Pauta semanal de inspecciones».
-- Los ITO que ya existen quedan con los 7 días habilitados (nada cambia hasta que los edites).
-- Ejecutar completo en el SQL Editor (elegir "Run without RLS" si pregunta). Se puede ejecutar más de una vez.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'usuarios' and column_name = 'dias_inspeccion') then
    alter table public.usuarios add column dias_inspeccion smallint[] not null default '{}';
    -- Solo la primera vez: los ITO actuales conservan el comportamiento de hoy (todos los días)
    update public.usuarios set dias_inspeccion = '{1,2,3,4,5,6,7}' where rol = 'ito';
  end if;
end $$;

alter table public.usuarios drop constraint if exists usuarios_dias_inspeccion_check;
alter table public.usuarios add constraint usuarios_dias_inspeccion_check
  check (dias_inspeccion <@ array[1,2,3,4,5,6,7]::smallint[]);

-- Regla común (1 = lunes … 7 = domingo). Solo restringe a quien tiene rol 'ito'.
create or replace function public._validar_inspeccion_ito(p_fecha date, p_inspeccion uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_rol text; v_dias smallint[]; v_creada timestamptz; v_dow integer;
begin
  if auth.uid() is null then return; end if;                       -- scripts de mantención
  select rol, dias_inspeccion into v_rol, v_dias from public.usuarios where id = auth.uid();
  if v_rol is distinct from 'ito' then return; end if;             -- admin, ito2 y demás: sin restricción

  v_dow := extract(isodow from p_fecha)::integer;
  if not (v_dow = any(coalesce(v_dias, '{}'))) then
    raise exception 'Ese día (%) no es uno de tus días de inspección. Ese día solo puedes ingresar fallas con «Agregar falla».',
      (array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[v_dow];
  end if;

  if p_inspeccion is not null then
    select creado_en into v_creada from public.inspecciones where id = p_inspeccion;
    if v_creada is not null and now() - v_creada > interval '4 hours' then
      raise exception 'Esa inspección se cerró automáticamente (pasaron más de 4 horas desde que se inició). Las nuevas fallas ingrésalas con «Agregar falla».';
    end if;
  end if;
end $$;

-- Crear / continuar una inspección
create or replace function public.obtener_o_crear_inspeccion(p_fecha date, p_ito uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rol text; v_ito uuid; v_id uuid;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
begin
  select rol into v_rol from public.usuarios where id = auth.uid();
  if v_rol is null or v_rol not in ('admin','ito','ito2') then
    raise exception 'No tienes permiso para registrar inspecciones';
  end if;
  v_ito := coalesce(p_ito, auth.uid());
  if v_ito <> auth.uid() and v_rol not in ('admin','ito2') then
    raise exception 'Solo admin o ito2 pueden registrar inspecciones a nombre de otro ITO';
  end if;
  if p_fecha is null then raise exception 'Falta la fecha de la inspección'; end if;
  if p_fecha > v_hoy then raise exception 'La fecha de la inspección no puede ser futura'; end if;

  select id into v_id from public.inspecciones where ito_id = v_ito and fecha = p_fecha;
  if v_id is not null then
    if p_fecha < v_hoy - 7 and v_rol <> 'admin' then
      raise exception 'Solo se puede continuar una inspección de los últimos 7 días';
    end if;
    perform public._validar_inspeccion_ito(p_fecha, v_id);
    return v_id;
  end if;

  if p_fecha < v_hoy - 7 and v_rol = 'ito' then
    raise exception 'Solo se pueden registrar inspecciones de los últimos 7 días';
  end if;
  perform public._validar_inspeccion_ito(p_fecha, null);

  insert into public.inspecciones (fecha, ito_id, creado_por)
  values (p_fecha, v_ito, auth.uid())
  on conflict (ito_id, fecha) do update set ito_id = excluded.ito_id
  returning id into v_id;
  return v_id;
end $$;

-- Aviso al elegir fecha: ahora también informa si la inspección ya se cerró
create or replace function public.inspeccion_existente(p_fecha date, p_ito uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_rol text; v_ito uuid; v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_id uuid; v_nombre text; v_n integer; v_creada timestamptz;
begin
  select rol into v_rol from public.usuarios where id = auth.uid();
  if v_rol is null or v_rol not in ('admin','ito','ito2') then
    return jsonb_build_object('existe', false);
  end if;
  v_ito := coalesce(p_ito, auth.uid());
  if v_ito <> auth.uid() and v_rol not in ('admin','ito2') then
    return jsonb_build_object('existe', false);
  end if;
  select i.id, u.nombre, i.creado_en into v_id, v_nombre, v_creada
  from public.inspecciones i join public.usuarios u on u.id = i.ito_id
  where i.ito_id = v_ito and i.fecha = p_fecha;
  if v_id is null then return jsonb_build_object('existe', false); end if;
  select count(*)::integer into v_n from public.fallas where inspeccion_id = v_id and cascada = false;
  return jsonb_build_object('existe', true, 'id', v_id, 'fallas', v_n, 'ito_nombre', v_nombre,
    'permitido', (p_fecha >= v_hoy - 7 or v_rol = 'admin'),
    'cerrada', (v_rol = 'ito' and now() - v_creada > interval '4 hours'));
end $$;

-- Cada falla ingresada dentro de una inspección vuelve a validar la regla (aunque la app quede abierta)
create or replace function public.validar_inspeccion_en_falla()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fecha date;
begin
  if new.inspeccion_id is null or coalesce(new.cascada, false) or auth.uid() is null then return new; end if;
  select fecha into v_fecha from public.inspecciones where id = new.inspeccion_id;
  if v_fecha is not null then
    perform public._validar_inspeccion_ito(v_fecha, new.inspeccion_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_validar_inspeccion_en_falla on public.fallas;
create trigger trg_validar_inspeccion_en_falla before insert on public.fallas
  for each row execute function public.validar_inspeccion_en_falla();

-- Comprobación: debe devolver 1 fila con la columna y 4 funciones
select (select count(*) from information_schema.columns where table_name = 'usuarios' and column_name = 'dias_inspeccion') as columna,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('_validar_inspeccion_ito','obtener_o_crear_inspeccion','inspeccion_existente','validar_inspeccion_en_falla')) as funciones;
