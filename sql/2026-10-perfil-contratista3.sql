-- Perfil "contratista3": igual que contratista2 + ve las inspecciones de todos los ITOs
-- y puede asignar de una vez las fallas de SU contrato de una inspección a un camión.
-- Idempotente (se puede ejecutar más de una vez). Ejecutar completo en el SQL Editor.

-- 1) El rol existe en el check de usuarios
alter table public.usuarios drop constraint if exists usuarios_rol_check;
alter table public.usuarios add constraint usuarios_rol_check
  check (rol = any (array['admin','ito','ito2','contratista','contratista2','contratista3','camion','observador']));

-- 2) Donde hoy figura 'contratista2' en una lista de roles, se suma 'contratista3'
--    (funciones y políticas RLS; se toma la definición real y se reemplaza el texto).
do $$
declare r record; v_def text; v_new text; n int := 0;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%''contratista2''%'
      and pg_get_functiondef(p.oid) not like '%''contratista3''%'
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '''contratista2''', '''contratista2'', ''contratista3''');
    execute v_new; n := n + 1;
    raise notice 'funcion actualizada: %', r.proname;
  end loop;
  for r in
    select * from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') like '%''contratista2''%' or coalesce(with_check,'') like '%''contratista2''%')
      and coalesce(qual,'') || coalesce(with_check,'') not like '%''contratista3''%'
  loop
    execute format('alter policy %I on %I.%I%s%s', r.policyname, r.schemaname, r.tablename,
      case when r.qual is not null then ' using (' || replace(r.qual, '''contratista2''::text', '''contratista2''::text, ''contratista3''::text') || ')' else '' end,
      case when r.with_check is not null then ' with check (' || replace(r.with_check, '''contratista2''::text', '''contratista2''::text, ''contratista3''::text') || ')' else '' end);
    n := n + 1;
    raise notice 'politica actualizada: % en %', r.policyname, r.tablename;
  end loop;
  raise notice 'Total actualizado: %', n;
end $$;

-- 3) Listado de inspecciones: el contratista3 ve las de todos los ITOs, pero los conteos
--    consideran solo las fallas de su(s) contrato(s).
create or replace function public.inspecciones_listado(p_inicio date, p_fin date, p_ito uuid default null)
returns table(inspeccion_id uuid, fecha date, ito_id uuid, ito_nombre text, ingresado_por text, creado_en timestamptz,
  fallas integer, fallas_punto integer, fallas_circuito integer, puntos_afectados integer,
  reparadas integer, pendientes integer, reiteradas integer, reportadas integer)
language sql stable security definer set search_path to 'public' as $$
  select i.id, i.fecha, i.ito_id, ui.nombre, uc.nombre, i.creado_en,
    (count(f.id) filter (where f.cascada = false))::integer,
    (count(f.id) filter (where f.cascada = false and f.tipo = 'punto'))::integer,
    (count(f.id) filter (where f.cascada = false and f.tipo = 'linea'))::integer,
    (count(distinct f.ref_punto_gid) filter (where f.tipo = 'punto'))::integer,
    (count(f.id) filter (where f.cascada = false and f.estado = 'reparada'))::integer,
    (count(f.id) filter (where f.cascada = false and f.estado = 'pendiente'))::integer,
    (count(f.id) filter (where f.cascada = false and f.estado = 'reiterada'))::integer,
    (count(f.id) filter (where f.cascada = false and f.estado = 'reportada'))::integer
  from public.inspecciones i
  join public.usuarios ui on ui.id = i.ito_id
  left join public.usuarios uc on uc.id = i.creado_por
  left join public.fallas f on f.inspeccion_id = i.id
       and (public.mi_rol() <> 'contratista3' or public.contrato_visible(f.contrato_id))
  where exists (select 1 from public.usuarios u
                where u.id = auth.uid()
                  and (u.rol in ('admin','ito2','contratista3')
                       or (u.rol = 'ito' and i.ito_id = auth.uid())))
    and i.fecha between p_inicio and p_fin
    and (p_ito is null or i.ito_id = p_ito)
  group by i.id, i.fecha, i.ito_id, ui.nombre, uc.nombre, i.creado_en
  order by i.fecha desc, ui.nombre;
$$;

create or replace function public.inspecciones_recientes(p_limite integer default 6)
returns table(inspeccion_id uuid, fecha date, ito_id uuid, ito_nombre text, ingresado_por text, creado_en timestamptz,
  fallas integer, fallas_punto integer, fallas_circuito integer, puntos_afectados integer,
  reparadas integer, pendientes integer, reiteradas integer, reportadas integer)
language sql stable security definer set search_path to 'public' as $$
  select x.id, x.fecha, x.ito_id, x.ito_nombre, x.ingresado_por, x.creado_en,
    x.fallas, x.fallas_punto, x.fallas_circuito, x.puntos_afectados,
    x.reparadas, x.pendientes, x.reiteradas, x.reportadas
  from (
    select i.id, i.fecha, i.ito_id, ui.nombre as ito_nombre, uc.nombre as ingresado_por, i.creado_en,
      (count(f.id) filter (where f.cascada = false))::integer as fallas,
      (count(f.id) filter (where f.cascada = false and f.tipo = 'punto'))::integer as fallas_punto,
      (count(f.id) filter (where f.cascada = false and f.tipo = 'linea'))::integer as fallas_circuito,
      (count(distinct f.ref_punto_gid) filter (where f.tipo = 'punto'))::integer as puntos_afectados,
      (count(f.id) filter (where f.cascada = false and f.estado = 'reparada'))::integer as reparadas,
      (count(f.id) filter (where f.cascada = false and f.estado = 'pendiente'))::integer as pendientes,
      (count(f.id) filter (where f.cascada = false and f.estado = 'reiterada'))::integer as reiteradas,
      (count(f.id) filter (where f.cascada = false and f.estado = 'reportada'))::integer as reportadas
    from public.inspecciones i
    join public.usuarios ui on ui.id = i.ito_id
    left join public.usuarios uc on uc.id = i.creado_por
    left join public.fallas f on f.inspeccion_id = i.id
         and (public.mi_rol() <> 'contratista3' or public.contrato_visible(f.contrato_id))
    where exists (select 1 from public.usuarios u
                  where u.id = auth.uid()
                    and (u.rol in ('admin','ito2','contratista3')
                         or (u.rol = 'ito' and i.ito_id = auth.uid())))
    group by i.id, i.fecha, i.ito_id, ui.nombre, uc.nombre, i.creado_en
    order by i.fecha desc, i.creado_en desc
    limit greatest(1, least(coalesce(p_limite, 6), 50))
  ) x
  order by x.fecha desc, x.ito_nombre;
$$;

-- 4) Detalle: todas las fallas de la inspección; cada una trae si es de "mi contrato" (para el contratista3)
create or replace function public.inspeccion_detalle(p_inspeccion uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select
    jsonb_build_object(
      'inspeccion', jsonb_build_object(
        'id', i.id, 'fecha', i.fecha, 'ito_id', i.ito_id, 'ito_nombre', ui.nombre,
        'ingresado_por', uc.nombre, 'creado_en', i.creado_en),
      'fallas', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', f.id, 'ot', f.ot, 'orden_externa', f.orden_externa, 'tipo', f.tipo,
            'tipo_falla', f.tipo_falla, 'cardinalidad', f.cardinalidad, 'estado', f.estado,
            'comentario_reporte', f.descripcion_otro, 'fecha_falla', f.fecha_falla,
            'fecha_ingreso', f.fecha_falla_real, 'ingresado_por', ucr.nombre,
            'puntos_afectados', case when f.tipo = 'linea'
                then (select count(*) from public.fallas fc where fc.circuito_origen_id = f.id) else 1 end,
            'llave', p.llave, 'nro_mun', p.nro_mun,
            'direccion', nullif(concat_ws(' ', p.calle_1, p.direccion), ''),
            'simb_poste', p.simb_poste, 'circuito_id', c.id,
            'geometry', coalesce(ST_AsGeoJSON(p.geom), ST_AsGeoJSON(c.geom))::jsonb,
            'asignado_camion', uca.nombre,
            'asignado_camion_id', f.asignado_camion_id,
            'contrato_id', f.contrato_id,
            'contrato_nombre', ct.nombre,
            'mi_contrato', public.contrato_visible(f.contrato_id),
            'reparacion', case when r.fecha_reparacion is not null then jsonb_build_object(
                'por', ur.nombre, 'fecha', r.fecha_reparacion, 'descripcion', r.descripcion) end,
            'pendiente', case when f.pendiente_por is not null then jsonb_build_object(
                'por', up.nombre, 'fecha', f.fecha_pendiente, 'motivo', f.motivo_pendiente) end,
            'comentarios', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'tipo', cm.tipo, 'comentario', cm.comentario,
                       'autor', cm.autor_nombre, 'fecha', cm.creado_en) order by cm.creado_en), '[]'::jsonb)
              from public.fallas_comentarios cm where cm.falla_id = f.id)
          )
          order by f.fecha_falla_real, f.ot, f.id
        )
        from public.fallas f
        left join public.puntos_luminarios p on f.tipo = 'punto' and p.gid = f.ref_punto_gid
        left join public.circuitos c        on f.tipo = 'linea' and c.gid = f.ref_circuito_gid
        left join public.contratos ct on ct.id = f.contrato_id
        left join public.usuarios ucr on ucr.id = f.creado_por
        left join public.usuarios uca on uca.id = f.asignado_camion_id
        left join public.usuarios up  on up.id  = f.pendiente_por
        left join lateral (
          select r2.fecha_reparacion, r2.descripcion, r2.reparado_por
          from public.reparaciones r2 where r2.falla_id = f.id
          order by r2.fecha_reparacion desc limit 1
        ) r on true
        left join public.usuarios ur on ur.id = r.reparado_por
        where f.inspeccion_id = i.id and f.cascada = false
      ), '[]'::jsonb)
    )
  from public.inspecciones i
  join public.usuarios ui on ui.id = i.ito_id
  left join public.usuarios uc on uc.id = i.creado_por
  where i.id = p_inspeccion
    and exists (select 1 from public.usuarios u
                where u.id = auth.uid()
                  and (u.rol in ('admin','ito2','contratista3')
                       or (u.rol = 'ito' and i.ito_id = auth.uid())));
$$;

-- 5) Camiones que el contratista3 puede elegir: los que comparten algún contrato con él
create or replace function public.listar_camiones_contrato()
returns table(id uuid, nombre text)
language sql stable security definer set search_path to 'public' as $$
  select u.id, u.nombre from public.usuarios u
  where u.rol = 'camion'
    and (public.mi_rol() = 'admin'
         or exists (select 1 from public.usuario_contratos a
                    join public.usuario_contratos b on b.contrato_id = a.contrato_id
                    where a.usuario_id = u.id and b.usuario_id = auth.uid()))
  order by u.nombre;
$$;

-- 6) Asignación rápida: asigna a un camión las fallas de la inspección que sean de MI contrato,
--    no reparadas, y cuyo camión pertenezca al contrato de la falla.
--    p_sobrescribir = false -> solo las que no tienen camión; true -> también reasigna las ya asignadas.
create or replace function public.asignar_camion_inspeccion(p_inspeccion uuid, p_camion uuid, p_sobrescribir boolean default false)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  if coalesce(public.mi_rol(), '') not in ('contratista3', 'admin') then
    raise exception 'Solo un Contratista3 o Admin puede asignar una inspección completa';
  end if;
  if not exists (select 1 from public.usuarios where id = p_camion and rol = 'camion') then
    raise exception 'El destino debe ser un usuario de rol camión';
  end if;
  update public.fallas f
     set asignado_camion_id = p_camion, asignado_por_id = auth.uid()
   where f.inspeccion_id = p_inspeccion
     and f.cascada = false
     and f.estado <> 'reparada'
     and public.contrato_visible(f.contrato_id)
     and f.contrato_id is not null
     and exists (select 1 from public.usuario_contratos uc where uc.usuario_id = p_camion and uc.contrato_id = f.contrato_id)
     and (p_sobrescribir or f.asignado_camion_id is null);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.listar_camiones_contrato() to authenticated;
grant execute on function public.asignar_camion_inspeccion(uuid, uuid, boolean) to authenticated;
