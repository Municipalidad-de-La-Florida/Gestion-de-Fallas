-- PERFILES Y PERMISOS — ETAPA 1: catálogo de funciones, perfiles y grilla perfil × función.
-- No cambia lo que ve ni lo que puede hacer nadie todavía: la web, la app y las políticas siguen usando usuarios.rol.
-- Esta etapa solo crea la base sobre la que se construirá la pantalla Configuración → Perfiles (etapa 2).
--
-- Cómo encaja con lo que ya existe:
--  * usuarios.rol NO se toca: sigue siendo el "rol técnico" que leen las políticas RLS y el código actual.
--  * usuarios.perfil (nuevo) es el perfil asignado. Un trigger deja siempre usuarios.rol = perfiles.base_rol,
--    así que todo lo que hoy mira el rol sigue funcionando igual, también con perfiles nuevos.
--  * Las 6 casillas por usuario (notificador, foto, masivo, rendimiento, fiscalización, ubicación) se mantienen como excepciones
--    por usuario. tiene_permiso() las suma al valor del perfil.

-- 1) Perfiles ---------------------------------------------------------------------------------------------------------
create table if not exists public.perfiles (
  clave     text primary key check (clave ~ '^[a-z0-9_]{2,40}$'),
  nombre    text not null,
  base_rol  text not null check (base_rol in ('admin','ito','ito2','contratista','contratista2','contratista3','camion','observador')),
  sistema   boolean not null default false,        -- los 8 originales no se pueden borrar
  orden     integer not null default 0,
  creado_en timestamptz not null default now()
);

insert into public.perfiles (clave, nombre, base_rol, sistema, orden) values
  ('admin',        'Administrador', 'admin',        true, 1),
  ('ito',          'ITO',           'ito',          true, 2),
  ('ito2',         'ITO 2',         'ito2',         true, 3),
  ('contratista',  'Contratista 1', 'contratista',  true, 4),
  ('contratista2', 'Contratista 2', 'contratista2', true, 5),
  ('contratista3', 'Contratista 3', 'contratista3', true, 6),
  ('camion',       'Camión',        'camion',       true, 7),
  ('observador',   'Observador',    'observador',   true, 8)
on conflict (clave) do nothing;

-- 2) Catálogo de funciones ---------------------------------------------------------------------------------------------
create table if not exists public.funciones (
  clave       text primary key,
  grupo       text not null,
  nombre      text not null,
  orden       integer not null default 0,
  por_usuario boolean not null default false       -- además del perfil, se puede dar o quitar a una persona (casilla en usuarios)
);

-- 3) Grilla perfil × función -------------------------------------------------------------------------------------------
create table if not exists public.perfil_funciones (
  perfil    text not null references public.perfiles(clave) on update cascade on delete cascade,
  funcion   text not null references public.funciones(clave) on update cascade on delete cascade,
  habilitado boolean not null default false,
  primary key (perfil, funcion)
);

-- 4) Perfil de cada usuario --------------------------------------------------------------------------------------------
alter table public.usuarios add column if not exists perfil text references public.perfiles(clave) on update cascade;
update public.usuarios set perfil = rol where perfil is null;

-- Mantiene perfil y rol en sintonía. Se llama "a_sync" para ejecutarse antes de trg_usuarios_limpiar_notificador.
create or replace function public.usuarios_sync_perfil()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare v_base text;
begin
  -- Si algo (la pantalla actual) cambia solo el rol, el perfil sigue al rol
  if tg_op = 'UPDATE' and new.rol is distinct from old.rol and new.perfil is not distinct from old.perfil then
    new.perfil := new.rol;
  end if;
  if new.perfil is null then new.perfil := new.rol; end if;
  select base_rol into v_base from public.perfiles where clave = new.perfil;
  if v_base is null then
    raise exception 'El perfil "%" no existe.', new.perfil;
  end if;
  new.rol := v_base;
  return new;
end;
$function$;

drop trigger if exists trg_usuarios_a_sync_perfil on public.usuarios;
create trigger trg_usuarios_a_sync_perfil
  before insert or update of rol, perfil on public.usuarios
  for each row execute function public.usuarios_sync_perfil();

alter table public.usuarios alter column perfil set not null;

-- 5) Seguridad de las tablas nuevas: todos leen, solo el admin escribe --------------------------------------------------
alter table public.perfiles         enable row level security;
alter table public.funciones        enable row level security;
alter table public.perfil_funciones enable row level security;

do $$
declare t text;
begin
  foreach t in array array['perfiles','funciones','perfil_funciones'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.mi_rol() = ''admin'')', t || '_admin_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.mi_rol() = ''admin'') with check (public.mi_rol() = ''admin'')', t || '_admin_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.mi_rol() = ''admin'')', t || '_admin_del', t);
  end loop;
end $$;

-- Los perfiles originales no se borran ni cambian de rol técnico
create or replace function public.perfiles_proteger()
returns trigger
language plpgsql set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    if old.sistema then raise exception 'Los perfiles originales no se pueden borrar.'; end if;
    return old;
  end if;
  if old.sistema and (new.clave is distinct from old.clave or new.base_rol is distinct from old.base_rol or new.sistema is distinct from old.sistema) then
    raise exception 'En los perfiles originales solo se puede cambiar el nombre.';
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_perfiles_proteger on public.perfiles;
create trigger trg_perfiles_proteger before update or delete on public.perfiles
  for each row execute function public.perfiles_proteger();

-- Un perfil con usuarios no se borra (la clave foránea de usuarios.perfil ya lo impide; este mensaje es más claro)
-- Los admin no pueden quitarse a sí mismos el acceso a esta pantalla
create or replace function public.perfil_funciones_proteger_admin()
returns trigger
language plpgsql set search_path to 'public'
as $function$
begin
  if new.funcion = 'admin_perfiles' and new.perfil = 'admin' and not new.habilitado then
    raise exception 'El administrador no puede perder el acceso a Perfiles y permisos.';
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_perfil_funciones_proteger_admin on public.perfil_funciones;
create trigger trg_perfil_funciones_proteger_admin before insert or update on public.perfil_funciones
  for each row execute function public.perfil_funciones_proteger_admin();

-- 6) Catálogo: funciones y grupos ---------------------------------------------------------------------------------------
-- Orden de la grilla de valores:  admin, ito, ito2, contratista, contratista2, contratista3, camion, observador
-- Las funciones "por_usuario" parten APAGADAS en los perfiles (salvo las del admin que hoy ya tiene): quien las tiene hoy las
-- conserva por su casilla individual, así nadie gana ni pierde nada al ejecutar esta etapa.
drop table if exists pg_temp._catalogo;
create temporary table _catalogo (clave text, grupo text, nombre text, orden int, por_usuario boolean, valores text);
insert into _catalogo values
 ('mapa_ver',                 'Mapa y consulta',        'Ver mapa, buscador y capas',                    10, false, '11111111'),
 ('suministro_indicador',     'Mapa y consulta',        'Indicador Enel en el mapa',                     20, false, '11111111'),
 ('suministro_avisos',        'Mapa y consulta',        'Avisos de clientes Enel',                       30, false, '11100000'),
 ('filtro_asignacion',        'Mapa y consulta',        'Filtros de asignación',                         40, false, '10011100'),
 ('modo_historial',           'Mapa y consulta',        'Modo historial de un punto',                    50, false, '10000000'),
 ('ver_fecha_real',           'Mapa y consulta',        'Ver fecha real e «ingresado por»',              60, false, '10000000'),

 ('informar_falla',           'Informar',               'Agregar falla individual',                      10, false, '11101100'),
 ('notificador_externo',      'Informar',               'Notificador externo y fecha/hora',              20, true,  '00000000'),
 ('informar_inspeccion',      'Informar',               'Informar inspección',                           30, false, '11100000'),

 ('inspecciones_propias',     'Inspecciones',           'Ver sus inspecciones',                          10, false, '11100000'),
 ('inspecciones_todas',       'Inspecciones',           'Ver inspecciones de todos los ITO',             20, false, '10100100'),
 ('inspeccion_editar',        'Inspecciones',           'Editar inspección y soltar fallas',             30, false, '10000000'),
 ('inspeccion_asignar_lote',  'Inspecciones',           'Asignar a camión en lote',                      40, false, '10000100'),
 ('operativo_activar',        'Inspecciones',           'Activar operativo',                             50, false, '10000000'),

 ('falla_editar_propia',      'Gestión de una falla',   'Editar o eliminar la propia (15 min)',          10, false, '11101100'),
 ('falla_editar_cualquiera',  'Gestión de una falla',   'Editar o eliminar cualquiera',                  20, false, '10000000'),
 ('falla_cambiar_contrato',   'Gestión de una falla',   'Cambiar el contrato de la falla',               30, false, '11101100'),
 ('falla_comentar',           'Gestión de una falla',   'Comentar',                                      40, false, '11111110'),
 ('pasar_a_masivo',           'Gestión de una falla',   'Pasar a masivo',                                50, true,  '00000000'),
 ('asignacion_quitar',        'Gestión de una falla',   'Quitar asignación de camión',                   60, false, '10000000'),

 ('reparacion_asignar_camion','Reparación y terreno',   'Asignar falla a camión',                        10, false, '10011100'),
 ('reparacion_cerrar',        'Reparación y terreno',   'Cerrar reparación y dejar pendiente',           20, false, '10011110'),
 ('reparacion_editar_propia', 'Reparación y terreno',   'Editar o quitar su reparación',                 30, false, '10011110'),
 ('foto_obligatoria',         'Reparación y terreno',   'Foto obligatoria al cerrar',                    40, true,  '00000000'),
 ('aporte_registrar',         'Reparación y terreno',   'Registrar aporte',                              50, false, '00000010'),
 ('maestros',                 'Reparación y terreno',   'Maestros (aportes)',                            60, false, '10011100'),
 ('ubicacion_gps_compartir',  'Reparación y terreno',   'Compartir ubicación GPS',                       70, false, '00000010'),

 ('todas_fallas',             'Listados y estadísticas','Todas las fallas',                              10, false, '11111100'),
 ('columnas_asignacion',      'Listados y estadísticas','Columnas de asignación',                        20, false, '10011100'),
 ('exportar_csv',             'Listados y estadísticas','Exportar CSV',                                  30, false, '11111100'),
 ('estadisticas',             'Listados y estadísticas','Estadísticas día y período',                    40, false, '11100000'),
 ('estadisticas_inspecciones','Listados y estadísticas','Pestaña Inspecciones',                          50, false, '11100000'),
 ('analisis',                 'Listados y estadísticas','Análisis y PDF',                                60, false, '10100000'),

 ('rendimiento_cuadrillas',   'Control de gestión',     'Rendimiento de cuadrillas',                     10, true,  '10000000'),
 ('fiscalizacion',            'Control de gestión',     'Fiscalización',                                 20, true,  '00000000'),
 ('ubicacion_camiones',       'Control de gestión',     'Ver ubicación de camiones',                     30, true,  '10000000'),

 ('push_falla_informada',     'Notificaciones push',    'Aviso: falla informada en su contrato',         10, false, '00011100'),
 ('push_falla_asignada',      'Notificaciones push',    'Aviso: falla asignada',                         20, false, '00000010'),
 ('push_falla_reparada',      'Notificaciones push',    'Aviso: falla reparada',                         30, false, '11111100'),

 ('admin_usuarios',           'Administración',         'Usuarios y roles',                              10, false, '10000000'),
 ('admin_contratos',          'Administración',         'Contratos',                                     20, false, '10000000'),
 ('admin_catalogos',          'Administración',         'Catálogos y códigos',                           30, false, '10000000'),
 ('admin_perfiles',           'Administración',         'Perfiles y permisos',                           40, false, '10000000'),
 ('ver_como',                 'Administración',         'Ver como (simulador)',                          50, false, '10000000');

-- Las funciones se actualizan si ya existían (nombre, grupo, orden); la grilla solo se rellena donde aún no hay valor,
-- de modo que volver a ejecutar este archivo no pisa lo que el admin haya cambiado después.
insert into public.funciones (clave, grupo, nombre, orden, por_usuario)
select clave, grupo, nombre, orden, por_usuario from _catalogo
on conflict (clave) do update set grupo = excluded.grupo, nombre = excluded.nombre, orden = excluded.orden, por_usuario = excluded.por_usuario;

insert into public.perfil_funciones (perfil, funcion, habilitado)
select p.clave, c.clave, substr(c.valores, p.orden, 1) = '1'
from _catalogo c
join public.perfiles p on p.sistema
on conflict (perfil, funcion) do nothing;

drop table if exists pg_temp._catalogo;

-- Perfiles nuevos: se copian de otro perfil con esta función
create or replace function public.crear_perfil(p_clave text, p_nombre text, p_copiar_de text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_base text;
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador puede crear perfiles.'; end if;
  select base_rol into v_base from public.perfiles where clave = p_copiar_de;
  if v_base is null then raise exception 'No existe el perfil a copiar.'; end if;
  insert into public.perfiles (clave, nombre, base_rol, sistema, orden)
  values (p_clave, btrim(p_nombre), v_base, false, (select coalesce(max(orden), 0) + 1 from public.perfiles));
  insert into public.perfil_funciones (perfil, funcion, habilitado)
  select p_clave, funcion, habilitado from public.perfil_funciones where perfil = p_copiar_de;
end;
$function$;
revoke all on function public.crear_perfil(text, text, text) from public, anon;
grant execute on function public.crear_perfil(text, text, text) to authenticated;

-- 7) ¿Tiene el usuario esta función? ------------------------------------------------------------------------------------
-- Perfil + excepción individual (solo las 6 casillas por usuario). Es lo que usarán la web, la app y, en la etapa 4, las políticas.
create or replace function public.tiene_permiso(p_funcion text)
returns boolean
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  u public.usuarios%rowtype;
  v_ok boolean;
begin
  select * into u from public.usuarios where id = auth.uid();
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
    else false end, false);
end;
$function$;
revoke all on function public.tiene_permiso(text) from public, anon;
grant execute on function public.tiene_permiso(text) to authenticated;

-- Todas las funciones que tiene quien consulta (la web y la app la leen una vez al entrar)
create or replace function public.mis_funciones()
returns text[]
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(array_agg(f.clave order by f.clave) filter (where public.tiene_permiso(f.clave)), '{}') from public.funciones f;
$function$;
revoke all on function public.mis_funciones() from public, anon;
grant execute on function public.mis_funciones() to authenticated;

-- Comprobación sugerida (debe dar 0 filas): usuarios cuyo rol no coincide con su perfil
-- select u.id, u.nombre, u.rol, u.perfil from public.usuarios u join public.perfiles p on p.clave = u.perfil where u.rol <> p.base_rol;
