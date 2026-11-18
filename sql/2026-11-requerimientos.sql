-- REQUERIMIENTOS · solicitudes que NO son fallas de alumbrado (despeje, retiro, instalación de luminaria u otro).
-- Se puede ejecutar más de una vez. Orden: este SQL → web → app.
-- Flujo: el solicitante ingresa y deriva a un contratista → el contratista asigna a una cuadrilla → la cuadrilla ejecuta
--        → el contratista revisa → el solicitante da el visto bueno (cierra) o rechaza. Todo queda en el historial.
-- Permisos POR USUARIO (no por perfil): usuarios.req_crear y usuarios.req_gestionar. Las cuadrillas ven solo lo que se les asigna.
-- Todo pasa por funciones (las tablas no se leen directo). El admin ve y puede actuar en todos.

-- 1) Permisos por usuario ----------------------------------------------------------------------------------------
alter table public.usuarios add column if not exists req_crear boolean not null default false;
alter table public.usuarios add column if not exists req_gestionar boolean not null default false;

insert into public.funciones (clave, grupo, nombre, orden, por_usuario) values
  ('req_crear',     'Requerimientos', 'Ingresar requerimientos',                                        60, true),
  ('req_gestionar', 'Requerimientos', 'Gestionar requerimientos (recibir, asignar a cuadrilla, revisar)', 61, true)
on conflict (clave) do update set grupo = excluded.grupo, nombre = excluded.nombre, orden = excluded.orden, por_usuario = excluded.por_usuario;

insert into public.perfil_funciones (perfil, funcion, habilitado)
select p.clave, f.k, false from public.perfiles p, (values ('req_crear'), ('req_gestionar')) f(k)
on conflict (perfil, funcion) do nothing;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.usuario_tiene_permiso(uuid,text)'::regprocedure);
  if position('req_crear' in d) = 0 then
    d := replace(d, E'when ''cuaderno''               then u.ver_cuaderno',
                    E'when ''cuaderno''               then u.ver_cuaderno\n    when ''req_crear''             then u.req_crear\n    when ''req_gestionar''         then u.req_gestionar');
    execute d;
  end if;
end $$;

-- 2) Tablas ---------------------------------------------------------------------------------------------------------
create sequence if not exists public.requerimientos_numero_seq;

create table if not exists public.requerimientos (
  id uuid primary key default gen_random_uuid(),
  numero integer not null unique default nextval('public.requerimientos_numero_seq'),
  tipo text not null check (tipo in ('despeje', 'retiro', 'instalacion', 'otro')),
  descripcion text not null check (length(btrim(descripcion)) > 0),
  ref_punto_gid integer,                       -- punto del catastro (puntos_luminarios.gid); null si es un punto libre
  lat double precision, lng double precision,  -- punto libre (no catastrado)
  ubicacion_texto text,                        -- dirección o referencia escrita
  urgente boolean not null default false,
  estado text not null default 'derivado' check (estado in ('derivado','asignado','ejecutado','revisado','devuelto','cerrado','anulado')),
  ronda integer not null default 1,            -- sube cada vez que se devuelve a ejecutar de nuevo
  creado_por uuid references public.usuarios(id) on delete set null,
  derivado_a uuid references public.usuarios(id) on delete set null,   -- contratista que lo gestiona
  asignado_a uuid references public.usuarios(id) on delete set null,   -- cuadrilla
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  cerrado_en timestamptz,
  check (ref_punto_gid is not null or (lat is not null and lng is not null))
);
create index if not exists req_estado on public.requerimientos (estado);
create index if not exists req_derivado on public.requerimientos (derivado_a) where derivado_a is not null;
create index if not exists req_asignado on public.requerimientos (asignado_a) where asignado_a is not null;
create index if not exists req_creado_por on public.requerimientos (creado_por);

create table if not exists public.requerimientos_historial (
  id bigserial primary key,
  req_id uuid not null references public.requerimientos(id) on delete cascade,
  fecha timestamptz not null default now(),
  usuario_id uuid references public.usuarios(id) on delete set null,
  accion text not null,
  estado_desde text, estado_hasta text,
  comentario text,
  destino uuid references public.usuarios(id) on delete set null
);
create index if not exists req_hist_req on public.requerimientos_historial (req_id, fecha);

create table if not exists public.requerimientos_fotos (
  id uuid primary key default gen_random_uuid(),
  req_id uuid not null references public.requerimientos(id) on delete cascade,
  momento text not null check (momento in ('solicitud', 'ejecucion')),
  ronda integer not null default 1,
  ruta text not null,
  bytes integer,
  subido_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now()
);
create index if not exists req_fotos_req on public.requerimientos_fotos (req_id);

alter table public.requerimientos enable row level security;
alter table public.requerimientos_historial enable row level security;
alter table public.requerimientos_fotos enable row level security;
revoke all on public.requerimientos, public.requerimientos_historial, public.requerimientos_fotos from public, anon, authenticated;
revoke all on sequence public.requerimientos_numero_seq from public, anon, authenticated;
revoke all on sequence public.requerimientos_historial_id_seq from public, anon, authenticated;

-- 3) Ayudas internas -------------------------------------------------------------------------------------------------
create or replace function public._req_codigo(n integer) returns text language sql immutable as
$$ select 'R-' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end $$;

create or replace function public._req_tipo_label(t text) returns text language sql immutable as
$$ select case t when 'despeje' then 'Despeje de luminaria' when 'retiro' then 'Retiro de luminaria' when 'instalacion' then 'Instalación de luminaria' else 'Otro' end $$;

create or replace function public._req_nombre(u uuid) returns text language sql stable security definer set search_path = public as
$$ select nombre from public.usuarios where id = u $$;

create or replace function public._req_ubic(r public.requerimientos) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'Llave ' || coalesce(p.llave::text, '—') || coalesce(' · ' || nullif(btrim(coalesce(p.calle_1, '') || ' ' || coalesce(p.frente_1::text, '')), ''), '')
       from public.puntos_luminarios p where p.gid = r.ref_punto_gid),
    nullif(btrim(r.ubicacion_texto), ''),
    'Punto en el mapa') $$;

create or replace function public._req_es_admin(u uuid) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select rol = 'admin' from public.usuarios where id = u), false) $$;

create or replace function public._req_ve(r public.requerimientos, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(u is not null and (
    public._req_es_admin(u) or coalesce(r.creado_por = u, false) or coalesce(r.derivado_a = u, false) or coalesce(r.asignado_a = u, false)
    or exists (select 1 from public.requerimientos_historial h where h.req_id = r.id and (h.usuario_id = u or h.destino = u))), false) $$;

-- Acciones que el usuario puede hacer ahora (las reglas viven solo aquí; la web y la app solo pintan botones)
create or replace function public._req_acciones(r public.requerimientos, u uuid) returns text[] language plpgsql stable security definer set search_path = public as $$
declare a text[] := '{}'; adm boolean := public._req_es_admin(u);
        cre boolean := coalesce(r.creado_por = u, false) or adm; ges boolean := coalesce(r.derivado_a = u, false) or adm; cua boolean := coalesce(r.asignado_a = u, false) or adm;
begin
  if not public._req_ve(r, u) then return a; end if;
  if r.estado in ('cerrado', 'anulado') then return a; end if;
  a := a || array['comentar'];
  if r.estado = 'derivado'  and ges then a := a || array['asignar', 'devolver_ito']; end if;
  if r.estado = 'asignado'  and ges then a := a || array['asignar']; end if;   -- reasignar
  if r.estado = 'asignado'  and cua then a := a || array['ejecutar', 'no_puede', 'subir_foto_ejecucion']; end if;
  if r.estado = 'ejecutado' and ges then a := a || array['revisar', 'devolver_a_cuadrilla']; end if;
  if r.estado = 'revisado'  and cre then a := a || array['cerrar', 'rechazar']; end if;
  if r.estado = 'devuelto'  and cre then a := a || array['derivar']; end if;
  if r.estado in ('derivado', 'devuelto') and cre then a := a || array['subir_foto_solicitud']; end if;
  if cre or ges then a := a || array['urgente']; end if;
  if cre then a := a || array['anular']; end if;
  return a;
end $$;

create or replace function public._req_avisar(p_dest uuid[], p_titulo text, p_cuerpo text, p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare d uuid[];
begin
  select coalesce(array_agg(distinct x), '{}') into d from unnest(p_dest) x where x is not null and x is distinct from auth.uid();
  if coalesce(array_length(d, 1), 0) = 0 then return; end if;
  perform public.notificar_push(d, p_titulo, p_cuerpo, './?req=' || p_id);
exception when others then raise warning '_req_avisar: %', sqlerrm;
end $$;

create or replace function public._req_json(r public.requerimientos, u uuid) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', r.id, 'numero', r.numero, 'codigo', public._req_codigo(r.numero),
    'tipo', r.tipo, 'tipo_label', public._req_tipo_label(r.tipo), 'descripcion', r.descripcion,
    'estado', r.estado, 'urgente', r.urgente, 'ronda', r.ronda,
    'ref_punto_gid', r.ref_punto_gid, 'ubicacion', public._req_ubic(r),
    'lat', coalesce(r.lat, (select st_y(st_centroid(p.geom)) from public.puntos_luminarios p where p.gid = r.ref_punto_gid)),
    'lng', coalesce(r.lng, (select st_x(st_centroid(p.geom)) from public.puntos_luminarios p where p.gid = r.ref_punto_gid)),
    'creado_por', jsonb_build_object('id', r.creado_por, 'nombre', public._req_nombre(r.creado_por)),
    'derivado_a', jsonb_build_object('id', r.derivado_a, 'nombre', public._req_nombre(r.derivado_a)),
    'asignado_a', jsonb_build_object('id', r.asignado_a, 'nombre', public._req_nombre(r.asignado_a)),
    'creado_en', r.creado_en, 'actualizado_en', r.actualizado_en, 'cerrado_en', r.cerrado_en,
    'acciones', to_jsonb(public._req_acciones(r, u)),
    'n_fotos_solicitud', (select count(*) from public.requerimientos_fotos f where f.req_id = r.id and f.momento = 'solicitud'),
    'n_fotos_ejecucion', (select count(*) from public.requerimientos_fotos f where f.req_id = r.id and f.momento = 'ejecucion' and f.ronda = r.ronda)) $$;

-- 4) Funciones que usa la app ------------------------------------------------------------------------------------------
create or replace function public.req_destinos() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); adm boolean := public._req_es_admin(auth.uid());
begin
  if u is null then raise exception 'Sin sesión'; end if;
  return jsonb_build_object(
    'gestores', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre) order by x.nombre), '[]') from public.usuarios x where x.req_gestionar),
    'cuadrillas', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre) order by x.nombre), '[]') from public.usuarios x
                    where x.rol = 'camion' and (adm or exists (select 1 from public.usuario_mantenedores a join public.usuario_mantenedores b on a.mantenedor_id = b.mantenedor_id
                                                                where a.usuario_id = u and b.usuario_id = x.id))));
end $$;

create or replace function public.req_crear(p_tipo text, p_descripcion text, p_punto_gid integer default null, p_lat double precision default null,
  p_lng double precision default null, p_ubicacion_texto text default null, p_urgente boolean default false, p_derivar_a uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r public.requerimientos%rowtype; v_desc text := btrim(coalesce(p_descripcion, ''));
begin
  if u is null then raise exception 'Sin sesión'; end if;
  if not (public._req_es_admin(u) or coalesce((select req_crear from public.usuarios where id = u), false)) then raise exception 'No tienes permiso para ingresar requerimientos'; end if;
  if p_tipo not in ('despeje', 'retiro', 'instalacion', 'otro') then raise exception 'Tipo de requerimiento no válido'; end if;
  if v_desc = '' then raise exception 'Escribe la solicitud'; end if;
  if p_punto_gid is not null then
    if not exists (select 1 from public.puntos_luminarios where gid = p_punto_gid) then raise exception 'El punto no existe en el catastro'; end if;
  elsif p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Indica el punto en el mapa';
  end if;
  if p_derivar_a is null or not exists (select 1 from public.usuarios where id = p_derivar_a and req_gestionar) then raise exception 'Elige un contratista habilitado para recibir el requerimiento'; end if;
  insert into public.requerimientos (tipo, descripcion, ref_punto_gid, lat, lng, ubicacion_texto, urgente, creado_por, derivado_a)
    values (p_tipo, v_desc, p_punto_gid, case when p_punto_gid is null then p_lat end, case when p_punto_gid is null then p_lng end,
            nullif(btrim(coalesce(p_ubicacion_texto, '')), ''), coalesce(p_urgente, false), u, p_derivar_a) returning * into r;
  insert into public.requerimientos_historial (req_id, usuario_id, accion, estado_hasta, comentario, destino) values (r.id, u, 'crear', 'derivado', v_desc, p_derivar_a);
  perform public._req_avisar(array[p_derivar_a], case when r.urgente then '🔴 URGENTE · ' else '' end || 'Nuevo requerimiento ' || public._req_codigo(r.numero),
    public._req_tipo_label(r.tipo) || ' · ' || public._req_ubic(r), r.id);
  return jsonb_build_object('id', r.id, 'codigo', public._req_codigo(r.numero));
end $$;

create or replace function public.req_listar(p_filtro text default 'abiertos', p_limite integer default 200) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); v jsonb;
begin
  if u is null then raise exception 'Sin sesión'; end if;
  select coalesce(jsonb_agg(q.j order by q.urg desc, q.t desc), '[]') into v from (
    select public._req_json(r, u) j, (r.urgente and r.estado not in ('cerrado', 'anulado')) urg, r.creado_en t
      from public.requerimientos r
     where public._req_ve(r, u)
       and case coalesce(p_filtro, 'abiertos') when 'abiertos' then r.estado not in ('cerrado', 'anulado') when 'cerrados' then r.estado = 'cerrado'
                 when 'anulados' then r.estado = 'anulado' else true end
     order by (r.urgente and r.estado not in ('cerrado', 'anulado')) desc, r.creado_en desc
     limit least(greatest(coalesce(p_limite, 200), 1), 500)) q;
  return v;
end $$;

-- Cuántos esperan una acción mía (para la insignia de la pestaña)
create or replace function public.req_contar() returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.requerimientos r where
    (r.estado = 'derivado' and r.derivado_a = auth.uid()) or (r.estado = 'asignado' and r.asignado_a = auth.uid())
    or (r.estado = 'ejecutado' and r.derivado_a = auth.uid()) or (r.estado in ('revisado', 'devuelto') and r.creado_por = auth.uid()) $$;

create or replace function public.req_detalle(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); r public.requerimientos%rowtype;
begin
  if u is null then raise exception 'Sin sesión'; end if;
  select * into r from public.requerimientos where id = p_id;
  if not found or not public._req_ve(r, u) then raise exception 'Requerimiento no encontrado'; end if;
  return jsonb_build_object('req', public._req_json(r, u),
    'historial', (select coalesce(jsonb_agg(jsonb_build_object('fecha', h.fecha, 'accion', h.accion, 'usuario', public._req_nombre(h.usuario_id), 'desde', h.estado_desde,
                   'hasta', h.estado_hasta, 'comentario', h.comentario, 'destino', public._req_nombre(h.destino)) order by h.fecha, h.id), '[]')
                   from public.requerimientos_historial h where h.req_id = r.id),
    'fotos', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'momento', f.momento, 'ronda', f.ronda, 'ruta', f.ruta, 'creado_en', f.creado_en,
                   'subido_por', public._req_nombre(f.subido_por), 'mia', f.subido_por = u) order by f.creado_en), '[]')
                   from public.requerimientos_fotos f where f.req_id = r.id));
end $$;

create or replace function public.req_accion(p_id uuid, p_accion text, p_comentario text default null, p_destino uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r public.requerimientos%rowtype; v_com text := nullif(btrim(coalesce(p_comentario, '')), '');
        v_desde text; v_log text := p_accion; v_cod text; v_t text; v_cu text; v_urg text;
        n_f integer;
begin
  if u is null then raise exception 'Sin sesión'; end if;
  select * into r from public.requerimientos where id = p_id for update;
  if not found or not public._req_ve(r, u) then raise exception 'Requerimiento no encontrado'; end if;
  if not (p_accion = any (public._req_acciones(r, u))) then raise exception 'No puedes hacer esa acción con este requerimiento en su estado actual'; end if;
  v_desde := r.estado; v_cod := public._req_codigo(r.numero);
  v_urg := case when r.urgente then '🔴 URGENTE · ' else '' end;
  v_t := v_urg || v_cod; v_cu := public._req_tipo_label(r.tipo) || ' · ' || public._req_ubic(r);

  if p_accion = 'comentar' then
    if v_com is null then raise exception 'Escribe un comentario'; end if;
    perform public._req_avisar(array[r.creado_por, r.derivado_a, r.asignado_a], v_t || ' · comentario', coalesce(public._req_nombre(u), '') || ': ' || left(v_com, 120), r.id);

  elsif p_accion = 'derivar' then
    if p_destino is null or not exists (select 1 from public.usuarios where id = p_destino and req_gestionar) then raise exception 'Elige un contratista habilitado'; end if;
    update public.requerimientos set estado = 'derivado', derivado_a = p_destino, asignado_a = null where id = r.id;
    perform public._req_avisar(array[p_destino], v_t || ' · derivado a ti', v_cu, r.id);

  elsif p_accion = 'asignar' then
    if p_destino is null or not exists (select 1 from public.usuarios where id = p_destino and rol = 'camion') then raise exception 'Elige una cuadrilla'; end if;
    if not public._req_es_admin(u) and not exists (select 1 from public.usuario_mantenedores a join public.usuario_mantenedores b on a.mantenedor_id = b.mantenedor_id
                                                    where a.usuario_id = u and b.usuario_id = p_destino) then raise exception 'Esa cuadrilla no es de tu mantenedor'; end if;
    if r.estado = 'asignado' then v_log := 'reasignar'; end if;
    update public.requerimientos set estado = 'asignado', asignado_a = p_destino where id = r.id;
    perform public._req_avisar(array[p_destino], v_t || ' · asignado a tu cuadrilla', v_cu, r.id);
    if r.estado = 'asignado' then perform public._req_avisar(array[r.asignado_a], v_t || ' · reasignado a otra cuadrilla', v_cu, r.id); end if;

  elsif p_accion = 'ejecutar' then
    select count(*) into n_f from public.requerimientos_fotos where req_id = r.id and momento = 'ejecucion' and ronda = r.ronda;
    if v_com is null and n_f = 0 then raise exception 'Escribe un comentario o sube al menos una foto'; end if;
    update public.requerimientos set estado = 'ejecutado' where id = r.id;
    perform public._req_avisar(array[r.derivado_a], v_t || ' · ejecutado, falta tu revisión', v_cu, r.id);

  elsif p_accion = 'no_puede' then
    if v_com is null then raise exception 'Explica por qué la cuadrilla no puede hacerlo'; end if;
    update public.requerimientos set estado = 'derivado', asignado_a = null where id = r.id;
    perform public._req_avisar(array[r.derivado_a], v_t || ' · la cuadrilla no puede hacerlo', left(v_com, 120), r.id);

  elsif p_accion = 'revisar' then
    update public.requerimientos set estado = 'revisado' where id = r.id;
    perform public._req_avisar(array[r.creado_por], v_t || ' · revisado, falta tu visto bueno', v_cu, r.id);

  elsif p_accion = 'devolver_a_cuadrilla' then
    if v_com is null then raise exception 'Explica qué falta'; end if;
    update public.requerimientos set estado = 'asignado', ronda = ronda + 1 where id = r.id;
    perform public._req_avisar(array[r.asignado_a], v_t || ' · devuelto a tu cuadrilla', left(v_com, 120), r.id);

  elsif p_accion = 'cerrar' then
    update public.requerimientos set estado = 'cerrado', cerrado_en = now() where id = r.id;
    perform public._req_avisar(array[r.derivado_a, r.asignado_a], v_t || ' · cerrado con visto bueno', v_cu, r.id);

  elsif p_accion = 'rechazar' then
    if v_com is null then raise exception 'Explica por qué lo rechazas'; end if;
    update public.requerimientos set estado = 'derivado', asignado_a = null, ronda = ronda + 1 where id = r.id;
    perform public._req_avisar(array[r.derivado_a], v_t || ' · rechazado por el solicitante', left(v_com, 120), r.id);

  elsif p_accion = 'devolver_ito' then
    if v_com is null then raise exception 'Explica el motivo de la devolución'; end if;
    update public.requerimientos set estado = 'devuelto', asignado_a = null where id = r.id;
    perform public._req_avisar(array[r.creado_por], v_t || ' · devuelto por el contratista', left(v_com, 120), r.id);

  elsif p_accion = 'anular' then
    if v_com is null then raise exception 'Explica el motivo de la anulación'; end if;
    update public.requerimientos set estado = 'anulado', cerrado_en = now() where id = r.id;
    perform public._req_avisar(array[r.derivado_a, r.asignado_a], v_t || ' · anulado', left(v_com, 120), r.id);

  elsif p_accion = 'urgente' then
    update public.requerimientos set urgente = not urgente where id = r.id;
    v_log := case when r.urgente then 'urgente_off' else 'urgente_on' end;
    if not r.urgente then perform public._req_avisar(array[r.creado_por, r.derivado_a, r.asignado_a], '🔴 URGENTE · ' || v_cod, v_cu, r.id); end if;

  else
    raise exception 'Acción no válida';
  end if;

  update public.requerimientos set actualizado_en = now() where id = r.id;
  insert into public.requerimientos_historial (req_id, usuario_id, accion, estado_desde, estado_hasta, comentario, destino)
    values (r.id, u, v_log, v_desde, (select estado from public.requerimientos where id = r.id), v_com, p_destino);
  return public._req_json((select x from public.requerimientos x where x.id = r.id), u);
end $$;

create or replace function public.req_registrar_foto(p_id uuid, p_momento text, p_ruta text, p_bytes integer default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r public.requerimientos%rowtype; n integer; v_id uuid;
begin
  if u is null then raise exception 'Sin sesión'; end if;
  select * into r from public.requerimientos where id = p_id for update;
  if not found or not public._req_ve(r, u) then raise exception 'Requerimiento no encontrado'; end if;
  if p_momento not in ('solicitud', 'ejecucion') then raise exception 'Momento no válido'; end if;
  if not (('subir_foto_' || p_momento) = any (public._req_acciones(r, u))) then raise exception 'No puedes subir fotos en este momento'; end if;
  if p_ruta is null or left(p_ruta, 37) <> p_id::text || '/' then raise exception 'Ruta de foto no válida'; end if;
  select count(*) into n from public.requerimientos_fotos where req_id = r.id and momento = p_momento and (p_momento = 'solicitud' or ronda = r.ronda);
  if n >= 2 then raise exception 'Máximo 2 fotos'; end if;
  insert into public.requerimientos_fotos (req_id, momento, ronda, ruta, bytes, subido_por) values (r.id, p_momento, r.ronda, p_ruta, p_bytes, u) returning id into v_id;
  insert into public.requerimientos_historial (req_id, usuario_id, accion, estado_desde, estado_hasta, comentario)
    values (r.id, u, 'foto_' || p_momento, r.estado, r.estado, null);
  return v_id;
end $$;

-- Devuelve la ruta para que quien llama borre el archivo del almacenamiento
create or replace function public.req_quitar_foto(p_foto uuid) returns text language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); f public.requerimientos_fotos%rowtype; r public.requerimientos%rowtype;
begin
  select * into f from public.requerimientos_fotos where id = p_foto;
  if not found then raise exception 'Foto no encontrada'; end if;
  select * into r from public.requerimientos where id = f.req_id;
  if not (f.subido_por = u or public._req_es_admin(u)) or not (('subir_foto_' || f.momento) = any (public._req_acciones(r, u))) then raise exception 'No puedes quitar esta foto'; end if;
  delete from public.requerimientos_fotos where id = p_foto;
  insert into public.requerimientos_historial (req_id, usuario_id, accion, estado_desde, estado_hasta) values (r.id, u, 'foto_quitada', r.estado, r.estado);
  return f.ruta;
end $$;

-- 5) Fotos: almacenamiento privado --------------------------------------------------------------------------------------
create or replace function public._req_foto_ok(p_nombre text, p_subir boolean) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r public.requerimientos%rowtype; u uuid := auth.uid();
begin
  select * into r from public.requerimientos where id = ((storage.foldername(p_nombre))[1])::uuid;
  if not found or u is null then return false; end if;
  if p_subir then return ('subir_foto_solicitud' = any (public._req_acciones(r, u))) or ('subir_foto_ejecucion' = any (public._req_acciones(r, u))); end if;
  return public._req_ve(r, u);
exception when others then return false;
end $$;

insert into storage.buckets (id, name, public) values ('fotos-requerimientos', 'fotos-requerimientos', false) on conflict (id) do nothing;
drop policy if exists req_fotos_select on storage.objects;
drop policy if exists req_fotos_insert on storage.objects;
drop policy if exists req_fotos_delete on storage.objects;
create policy req_fotos_select on storage.objects for select to authenticated using (bucket_id = 'fotos-requerimientos' and public._req_foto_ok(name, false));
create policy req_fotos_insert on storage.objects for insert to authenticated with check (bucket_id = 'fotos-requerimientos' and public._req_foto_ok(name, true));
create policy req_fotos_delete on storage.objects for delete to authenticated using (bucket_id = 'fotos-requerimientos' and public._req_foto_ok(name, true));

-- 6) Permisos de ejecución ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like '\_req\_%' or p.proname like 'req\_%') loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
