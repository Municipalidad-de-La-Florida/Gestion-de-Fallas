-- La falla guarda la luminaria que falló (modelo y potencia) para mostrarla en la ficha (web y app).
-- Se puede ejecutar más de una vez.

alter table public.fallas add column if not exists lum_modelo text;
alter table public.fallas add column if not exists lum_potencia integer;

-- Luminaria única del punto para ese uso (vial/peatonal). Si hay más de una distinta, no devuelve nada (la elige el usuario al reportar).
create or replace function public.luminaria_de_falla(p_gid integer, p_uso text, p_codigo text)
returns table(modelo text, potencia integer)
language sql stable security definer set search_path to 'public'
as $function$
  select (array_agg(x.m))[1], (array_agg(x.pt))[1]
    from (select distinct coalesce(nullif(btrim(l.modelo), ''), nullif(btrim(l.tipo_lum), ''), 'Sin modelo') as m, l.potencia::int as pt
            from public.puntos_luminarios p
            join public.luminarias l on l.llave = p.llave
           where p.gid = p_gid
             and l.uso_grupo = coalesce(nullif(upper(btrim(p_uso)), ''),
                   case when p_codigo in ('F01','F04','F05') then 'VIAL' when p_codigo in ('F29','F32','F33') then 'PEATONAL' end,
                   l.uso_grupo)) x
  having count(*) = 1;
$function$;
revoke all on function public.luminaria_de_falla(integer, text, text) from public, anon;
grant execute on function public.luminaria_de_falla(integer, text, text) to authenticated;

-- Al crear una falla de luminaria sin luminaria indicada, se completa sola cuando es única
create or replace function public.fallas_set_luminaria()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.tipo = 'punto' and new.lum_modelo is null and new.ref_punto_gid is not null
     and new.tipo_falla = any (array['F01','F04','F05','F22','F23','F29','F32','F33','F38']) then
    select s.modelo, s.potencia into new.lum_modelo, new.lum_potencia
      from public.luminaria_de_falla(new.ref_punto_gid, new.uso_grupo, new.tipo_falla) s;
  end if;
  return new;
end $function$;
drop trigger if exists trg_fallas_set_luminaria on public.fallas;
create trigger trg_fallas_set_luminaria before insert on public.fallas
  for each row execute function public.fallas_set_luminaria();

-- crear_falla_punto (app): parámetros nuevos p_lum_modelo y p_lum_potencia (resto idéntico)
drop function if exists public.crear_falla_punto(integer, text, text, text, text, timestamptz, uuid, uuid, boolean, text, uuid, uuid, boolean);
create function public.crear_falla_punto(p_punto_gid integer, p_tipo_falla text, p_cardinalidad text DEFAULT NULL::text, p_descripcion text DEFAULT NULL::text, p_orden_externa text DEFAULT NULL::text, p_fecha_falla timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notificador_id uuid DEFAULT NULL::uuid, p_inspeccion_id uuid DEFAULT NULL::uuid, p_masivo boolean DEFAULT false, p_uso_grupo text DEFAULT NULL::text, p_contrato_id uuid DEFAULT NULL::uuid, p_mantenedor_id uuid DEFAULT NULL::uuid, p_lum_masivo boolean DEFAULT NULL::boolean, p_lum_modelo text DEFAULT NULL::text, p_lum_potencia integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_desc   text := nullif(btrim(p_descripcion), '');
  v_oe     text := nullif(btrim(p_orden_externa), '');
  v_fecha  timestamptz := coalesce(p_fecha_falla, now());
  v_uso    text := nullif(upper(btrim(p_uso_grupo)), '');
  v_id     uuid;
  v_ot     text;
  v_estado text;
begin
  if v_uid is null then raise exception 'Sin sesión'; end if;

  if not exists (select 1 from public.puntos_luminarios where gid = p_punto_gid and activo) then
    raise exception 'El punto lumínico no existe o está inactivo';
  end if;
  if p_tipo_falla is null or not (p_tipo_falla = any (array['F01','F02','F03','F04','F05','F20','F22','F23','F29','F32','F33','F35','F38','F42','F43','OTRO'])) then
    raise exception 'Código de falla no válido para un punto';
  end if;
  if p_tipo_falla = 'OTRO' and v_desc is null then
    raise exception 'Describe la falla (obligatorio si es OTRO)';
  end if;
  if p_cardinalidad is not null and not (p_cardinalidad = any (array['N','S','P','O'])) then
    raise exception 'Cardinalidad no válida';
  end if;
  if v_oe is not null and v_oe !~ '^[SE]-[^[:space:]]{1,38}$' then
    raise exception 'La orden externa debe ser empresa + número (S-123 o E-123)';
  end if;
  if v_uso is not null and v_uso not in ('VIAL', 'PEATONAL', 'OTRO') then
    raise exception 'Tipo de uso no válido';
  end if;

  insert into public.fallas
    (tipo, ref_punto_gid, tipo_falla, cardinalidad, descripcion_otro, cascada,
     creado_por, orden_externa, fecha_falla, notificador_id, inspeccion_id, masivo,
     uso_grupo, contrato_id, mantenedor_id, lum_masivo, lum_modelo, lum_potencia)
  values
    ('punto', p_punto_gid, p_tipo_falla, p_cardinalidad, v_desc, false,
     v_uid, v_oe, v_fecha, p_notificador_id, p_inspeccion_id, coalesce(p_masivo, false),
     v_uso, p_contrato_id, p_mantenedor_id, p_lum_masivo, nullif(btrim(p_lum_modelo), ''), p_lum_potencia)
  returning id, ot, estado into v_id, v_ot, v_estado;

  if p_masivo then
    insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre, creado_en)
    values (v_id, 'masivo', 'Masivo', v_uid, (select nombre from public.usuarios where id = v_uid), now() - interval '1 second');
  end if;
  if v_desc is not null then
    insert into public.fallas_comentarios (falla_id, tipo, comentario, autor_id, autor_nombre)
    values (v_id, 'reporte', v_desc, v_uid, (select nombre from public.usuarios where id = v_uid));
  end if;

  return jsonb_build_object('id', v_id, 'ot', v_ot, 'estado', v_estado);
end;
$function$;
revoke all on function public.crear_falla_punto(integer, text, text, text, text, timestamptz, uuid, uuid, boolean, text, uuid, uuid, boolean, text, integer) from public, anon;
grant execute on function public.crear_falla_punto(integer, text, text, text, text, timestamptz, uuid, uuid, boolean, text, uuid, uuid, boolean, text, integer) to authenticated;

-- Fallas ya reportadas: se completa la luminaria cuando el punto tiene una sola en ese uso
do $$
begin
  perform set_config('app.editando_falla', '1', true);
  update public.fallas f
     set (lum_modelo, lum_potencia) = (select s.modelo, s.potencia from public.luminaria_de_falla(f.ref_punto_gid, f.uso_grupo, f.tipo_falla) s)
   where f.tipo = 'punto' and f.lum_modelo is null and f.ref_punto_gid is not null
     and f.tipo_falla = any (array['F01','F04','F05','F22','F23','F29','F32','F33','F38']);
end $$;
