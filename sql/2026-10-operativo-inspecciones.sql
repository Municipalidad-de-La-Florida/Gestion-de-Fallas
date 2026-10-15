-- «Operativo»: el administrador habilita una fecha en que TODOS los ITO pueden ingresar inspecciones
-- (emergencias, temporales, rondas especiales), aunque no sea uno de sus días de la pauta semanal.
-- Requiere haber ejecutado antes sql/2026-10-pauta-inspecciones.sql. Se puede ejecutar más de una vez.

create table if not exists public.operativos_inspeccion (
  fecha date primary key,
  motivo text,
  creado_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now()
);
alter table public.operativos_inspeccion enable row level security;
drop policy if exists operativos_select on public.operativos_inspeccion;
create policy operativos_select on public.operativos_inspeccion for select to authenticated using (true);
-- Sin políticas de escritura: solo se modifica con las funciones de abajo (solo admin)

create or replace function public.activar_operativo(p_fecha date, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador puede activar un operativo'; end if;
  if p_fecha is null then raise exception 'Falta la fecha del operativo'; end if;
  insert into public.operativos_inspeccion (fecha, motivo, creado_por)
  values (p_fecha, nullif(trim(p_motivo), ''), auth.uid())
  on conflict (fecha) do update set motivo = excluded.motivo;
end $$;

create or replace function public.quitar_operativo(p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador puede quitar un operativo'; end if;
  delete from public.operativos_inspeccion where fecha = p_fecha;
end $$;

-- La regla de la pauta ahora también deja pasar las fechas con operativo
create or replace function public._validar_inspeccion_ito(p_fecha date, p_inspeccion uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_rol text; v_dias smallint[]; v_creada timestamptz; v_dow integer;
begin
  if auth.uid() is null then return; end if;
  select rol, dias_inspeccion into v_rol, v_dias from public.usuarios where id = auth.uid();
  if v_rol is distinct from 'ito' then return; end if;

  v_dow := extract(isodow from p_fecha)::integer;
  if not (v_dow = any(coalesce(v_dias, '{}')))
     and not exists (select 1 from public.operativos_inspeccion where fecha = p_fecha) then
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

-- Comprobación: tabla = 1, funciones = 3
select (select count(*) from information_schema.tables where table_name = 'operativos_inspeccion') as tabla,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('activar_operativo','quitar_operativo','_validar_inspeccion_ito')) as funciones;
