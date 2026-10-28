-- INFORME DE REPARACIONES (por contrato y mantenedor) · solo para usuarios habilitados.
-- Se puede ejecutar más de una vez.
--  1) Nueva función «informe_reparaciones» en Control de gestión (apagada para todos los perfiles) + casilla por usuario.
--  2) Nombre completo de los contratos (sale en la cabecera del informe).
--  3) informe_reparaciones_opciones(): qué contrato + mantenedor puede sacar quien consulta (según lo que ve hoy).
--  4) informe_reparaciones(...): resumen y detalle de las reparaciones del período (muestra al azar repartida por día).
--  5) Habilita a Nicolás Sepúlveda y a Daniel Castillo (admin).

-- 1) Permiso ------------------------------------------------------------------------------------------------------
alter table public.usuarios add column if not exists ver_informe_rep boolean not null default false;

insert into public.funciones (clave, grupo, nombre, orden, por_usuario)
values ('informe_reparaciones', 'Control de gestión', 'Informe de reparaciones', 40, true)
on conflict (clave) do update set grupo = excluded.grupo, nombre = excluded.nombre, orden = excluded.orden, por_usuario = excluded.por_usuario;

insert into public.perfil_funciones (perfil, funcion, habilitado)
select p.clave, 'informe_reparaciones', false from public.perfiles p
on conflict (perfil, funcion) do nothing;

create or replace function public.usuario_tiene_permiso(p_usuario uuid, p_funcion text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare u public.usuarios%rowtype; v_ok boolean;
begin
  if p_usuario is null then return false; end if;
  select * into u from public.usuarios where id = p_usuario;
  if not found then return false; end if;
  select pf.habilitado into v_ok from public.perfil_funciones pf where pf.perfil = u.perfil and pf.funcion = p_funcion;
  if coalesce(v_ok, false) then return true; end if;
  return coalesce(case p_funcion
    when 'notificador_externo'    then u.notificador_externo_habilitado
    when 'pasar_a_masivo'         then u.puede_pasar_a_masivo
    when 'foto_obligatoria'       then u.foto_obligatoria
    when 'rendimiento_cuadrillas' then u.ver_cuadrillas
    when 'fiscalizacion'          then u.ver_fiscalizacion
    when 'ubicacion_camiones'     then u.ver_ubicacion
    when 'informe_reparaciones'   then u.ver_informe_rep
    else false end, false);
end;
$function$;
revoke all on function public.usuario_tiene_permiso(uuid, text) from public, anon;
grant execute on function public.usuario_tiene_permiso(uuid, text) to authenticated;

-- 2) Nombre completo de los contratos -------------------------------------------------------------------------------
alter table public.contratos add column if not exists nombre_completo text;
update public.contratos set nombre_completo = 'Prestación de servicios de mantenimiento integral del Alumbrado Público con criterio de eficiencia energética para la comuna de La Florida'
 where nombre in ('Enel X', 'Enel X - Clever');
update public.contratos set nombre_completo = 'Servicio de Mantenimiento de Alumbrado Público con tecnología LED en varios sectores de la comuna de La Florida'
 where nombre = 'Elecnor';

-- 3) Qué informes puede sacar quien consulta ------------------------------------------------------------------------
create or replace function public.informe_reparaciones_opciones()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso('informe_reparaciones') then
    raise exception 'No tienes permiso para sacar el informe de reparaciones';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'contrato_id', x.contrato_id, 'contrato', c.nombre, 'contrato_completo', coalesce(c.nombre_completo, c.nombre),
             'mantenedor_id', x.mantenedor_id, 'mantenedor', m.nombre) order by c.nombre, m.nombre nulls last)
    from (select distinct f.contrato_id, f.mantenedor_id
            from public.fallas f join public.reparaciones r on r.falla_id = f.id
           where f.cascada is not true and f.contrato_id is not null
             and public.falla_visible(f.contrato_id, f.mantenedor_id)) x
    join public.contratos c on c.id = x.contrato_id
    left join public.mantenedores m on m.id = x.mantenedor_id
  ), '[]'::jsonb);
end $$;
revoke all on function public.informe_reparaciones_opciones() from public, anon;
grant execute on function public.informe_reparaciones_opciones() to authenticated;

-- 4) El informe -------------------------------------------------------------------------------------------------------
-- p_pares: [{"contrato_id": "...", "mantenedor_id": "..." | null}, ...]; p_asignadores: ids de quien asignó (null = todos)
-- p_muestra: null = todas las reparaciones; N = N al azar, repartidas lo más parejo posible entre los días
create or replace function public.informe_reparaciones(p_desde date, p_hasta date, p_pares jsonb, p_asignadores uuid[] default null, p_muestra integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  par jsonb; pares jsonb[] := '{}'; cnts int[] := '{}'; q int[] := '{}';
  v_c uuid; v_m uuid; v_out jsonb := '[]'::jsonb; v_det jsonb; v_res jsonb;
  tot int := 0; n int; i int; j int; k int; rem int; best numeric; fr numeric; v_n int;
begin
  if not public.tiene_permiso('informe_reparaciones') then
    raise exception 'No tienes permiso para sacar el informe de reparaciones';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Período no válido'; end if;

  -- 1) cuántas reparaciones tiene cada informe pedido (solo los que la persona puede ver)
  for par in select * from jsonb_array_elements(coalesce(p_pares, '[]'::jsonb)) loop
    v_c := nullif(par->>'contrato_id', '')::uuid; v_m := nullif(par->>'mantenedor_id', '')::uuid;
    if v_c is null or not public.falla_visible(v_c, v_m) then continue; end if;
    pares := pares || par;
    cnts := cnts || (select count(distinct f.id)::int
      from public.fallas f join public.reparaciones r on r.falla_id = f.id
     where f.cascada is not true and f.contrato_id = v_c and f.mantenedor_id is not distinct from v_m
       and (r.fecha_reparacion at time zone 'America/Santiago')::date between p_desde and p_hasta
       and (p_asignadores is null or f.asignado_por_id = any(p_asignadores)));
  end loop;
  n := coalesce(array_length(cnts, 1), 0);
  select coalesce(sum(x), 0) into tot from unnest(cnts) x;

  -- 2) la muestra pedida es el TOTAL del informe: se reparte entre los informes en proporción a sus reparaciones
  q := cnts;
  if p_muestra is not null and p_muestra > 0 and tot > p_muestra then
    for i in 1..n loop q[i] := floor(p_muestra::numeric * cnts[i] / tot)::int; end loop;
    select p_muestra - coalesce(sum(x), 0) into rem from unnest(q) x;
    for k in 1..rem loop
      best := -1; j := 0;
      for i in 1..n loop
        if q[i] < cnts[i] then fr := p_muestra::numeric * cnts[i] / tot - q[i]; if fr > best then best := fr; j := i; end if; end if;
      end loop;
      if j > 0 then q[j] := q[j] + 1; end if;
    end loop;
  end if;

  -- 3) cada informe
  i := 0;
  foreach par in array pares loop
    i := i + 1;
    v_c := nullif(par->>'contrato_id', '')::uuid; v_m := nullif(par->>'mantenedor_id', '')::uuid;
    create temp table if not exists _inf (falla_id uuid, dia date, rep timestamptz, trabajo text, rep_por uuid, rn int) on commit drop;
    truncate _inf;
    insert into _inf
    select distinct on (f.id) f.id, (r.fecha_reparacion at time zone 'America/Santiago')::date, r.fecha_reparacion, r.descripcion, r.reparado_por, 0
      from public.fallas f join public.reparaciones r on r.falla_id = f.id
     where f.cascada is not true and f.contrato_id = v_c and f.mantenedor_id is not distinct from v_m
       and (r.fecha_reparacion at time zone 'America/Santiago')::date between p_desde and p_hasta
       and (p_asignadores is null or f.asignado_por_id = any(p_asignadores))
     order by f.id, r.fecha_reparacion desc;   -- una fila por falla (la última reparación del período)

    v_res := jsonb_build_object(
      'total', (select count(*) from _inf),
      'dias', (select count(distinct dia) from _inf),
      'trabajos', coalesce((select jsonb_agg(jsonb_build_object('trabajo', t, 'cant', n2) order by n2 desc, t)
                              from (select btrim(l) t, count(*) n2 from _inf, regexp_split_to_table(coalesce(trabajo, ''), E'\n') l
                                     where btrim(l) <> '' group by 1) z), '[]'::jsonb),
      'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'cant', n2) order by dia)
                             from (select dia, count(*) n2 from _inf group by 1) z), '[]'::jsonb),
      'por_codigo', coalesce((select jsonb_agg(jsonb_build_object('codigo', tipo_falla, 'descripcion', d, 'cant', n2) order by n2 desc, tipo_falla)
                                from (select f.tipo_falla, cf.descripcion d, count(*) n2
                                        from _inf i2 join public.fallas f on f.id = i2.falla_id
                                        left join public.codigos_falla cf on cf.codigo = f.tipo_falla
                                       group by 1, 2) z), '[]'::jsonb));

    -- muestra de este informe: se numera al azar dentro de cada día y se toman las primeras (reparte parejo entre los días)
    v_n := q[i];
    if p_muestra is not null and p_muestra > 0 and v_n < cnts[i] then
      update _inf t set rn = s.rn from (select falla_id, row_number() over (partition by dia order by random()) rn from _inf) s where s.falla_id = t.falla_id;
      delete from _inf where falla_id not in (select falla_id from _inf order by rn, random() limit v_n);
    end if;

    select coalesce(jsonb_agg(d order by (d->>'reparada_en')), '[]'::jsonb) into v_det from (
      select jsonb_build_object(
        'falla_id', f.id, 'ot', f.ot, 'orden_externa', f.orden_externa, 'tipo', f.tipo, 'codigo', f.tipo_falla,
        'descripcion_falla', cf.descripcion,
        'llave', p.llave, 'nro_mun', p.nro_mun, 'calle', nullif(concat_ws(' ', p.calle_1, p.direccion), ''), 'poste', p.simb_poste,
        'circuito', c.id,
        'puntos_afectados', case when f.tipo = 'linea' then (select count(*) from public.fallas fc where fc.circuito_origen_id = f.id) end,
        'comentario', (select fc.comentario from public.fallas_comentarios fc where fc.falla_id = f.id and fc.tipo = 'reporte' order by fc.creado_en limit 1),
        'informada_en', coalesce(f.fecha_falla_real, f.fecha_falla),
        'informada_por', coalesce((select u2.nombre from public.usuarios u2 where u2.id::text = f.informado_por::text), f.informado_por::text, uc.nombre),
        'reparada_en', i3.rep, 'trabajo', i3.trabajo,
        'repara', ur.nombre,
        'cuadrilla', case when ur.rol = 'camion' then ur.nombre else coalesce(ua.nombre, ur.nombre) end,
        'fotos', coalesce((select jsonb_agg(ff.ruta order by ff.creado_en) from public.fallas_fotos ff where ff.falla_id = f.id and ff.archivada_en is null), '[]'::jsonb)
      ) d
      from _inf i3
      join public.fallas f on f.id = i3.falla_id
      left join public.codigos_falla cf on cf.codigo = f.tipo_falla
      left join public.puntos_luminarios p on f.tipo = 'punto' and p.gid = f.ref_punto_gid
      left join public.circuitos c on f.tipo = 'linea' and c.gid = f.ref_circuito_gid
      left join public.usuarios uc on uc.id = f.creado_por
      left join public.usuarios ua on ua.id = f.asignado_camion_id
      left join public.usuarios ur on ur.id = i3.rep_por
    ) z;

    v_out := v_out || jsonb_build_object(
      'contrato_id', v_c, 'mantenedor_id', v_m,
      'contrato', (select coalesce(nombre_completo, nombre) from public.contratos where id = v_c),
      'contrato_corto', (select nombre from public.contratos where id = v_c),
      'mantenedor', (select nombre from public.mantenedores where id = v_m),
      'resumen', v_res, 'detalle', v_det);
  end loop;
  return v_out;
end $$;
revoke all on function public.informe_reparaciones(date, date, jsonb, uuid[], integer) from public, anon;
grant execute on function public.informe_reparaciones(date, date, jsonb, uuid[], integer) to authenticated;

-- 5) Habilitados ------------------------------------------------------------------------------------------------------
update public.usuarios set ver_informe_rep = true
 where id in ('440b7279-9fc4-4fec-816d-21f01cd0e21d', '51085242-8dc1-44ab-9314-9f7045c881bd');   -- Nicolás Sepúlveda, Daniel Castillo
