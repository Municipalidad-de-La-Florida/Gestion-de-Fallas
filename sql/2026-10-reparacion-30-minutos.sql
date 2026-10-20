-- Editar / quitar una reparación: la ventana de quien la registró pasa de 10 a 30 minutos (el admin siempre puede).
-- Corrige además "Quitar reparación": la tabla reparaciones_anuladas guardaba la OS como número y ahora es texto (26-0317).
-- Se puede ejecutar más de una vez.

alter table public.reparaciones_anuladas alter column ot type text using ot::text;

create or replace function public.reparacion_estado(p_falla_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_rol text; f public.fallas%rowtype; r public.reparaciones%rowtype; v_seg integer; v_otra boolean;
begin
  select rol into v_rol from public.usuarios where id = auth.uid();
  select * into f from public.fallas where id = p_falla_id;
  if not found or f.cascada or f.estado <> 'reparada' then return jsonb_build_object('puede', false); end if;
  select * into r from public.reparaciones where falla_id = p_falla_id order by creado_en desc limit 1;
  if not found then return jsonb_build_object('puede', false); end if;
  if v_rol = 'admin' then
    v_seg := null;
  elsif v_rol in ('contratista','contratista2','contratista3','camion') and r.reparado_por = auth.uid()
        and r.creado_en > now() - interval '30 minutes' then
    v_seg := greatest(0, extract(epoch from (r.creado_en + interval '30 minutes' - now()))::integer);
  else
    return jsonb_build_object('puede', false);
  end if;
  select exists (select 1 from public.fallas o where o.id <> f.id and o.estado <> 'reparada'
                   and ((f.tipo = 'punto' and o.ref_punto_gid = f.ref_punto_gid)
                     or (f.tipo = 'linea' and o.ref_circuito_gid = f.ref_circuito_gid))) into v_otra;
  return jsonb_build_object('puede', true, 'segundos', v_seg, 'bloqueada_por_otra_falla', v_otra,
    'descripcion', r.descripcion, 'tipo_falla', f.tipo_falla, 'tipo', f.tipo, 'descripcion_otro', f.descripcion_otro,
    'orden_externa', f.orden_externa);
end $function$;

create or replace function public._reparacion_autorizada(p_falla_id uuid)
returns public.reparaciones language plpgsql stable security definer set search_path to 'public'
as $function$
declare r public.reparaciones; v jsonb;
begin
  v := public.reparacion_estado(p_falla_id);
  if not coalesce((v->>'puede')::boolean, false) then
    raise exception 'No puedes modificar esta reparación (solo quien la registró, dentro de 30 minutos, o el admin)';
  end if;
  select * into r from public.reparaciones where falla_id = p_falla_id order by creado_en desc limit 1;
  return r;
end $function$;
