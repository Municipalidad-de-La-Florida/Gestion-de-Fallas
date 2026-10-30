-- "Sin Mantenimiento - Luminaria en recepción"
-- Las capas traen CONTRATO = 'SIN CONTRATO' y MANTENEDOR = 'EN RECEPCION' (o 'SIN MANTENEDOR').
-- Sin cambiar firmas: el nombre del mantenedor ahora viene como 'EN RECEPCION' cuando corresponde,
-- y estado_mantencion_circuito devuelve 'recepcion' para circuitos en recepción.
-- Los clientes antiguos siguen mostrando el aviso genérico (solo comparan con 'ok').

create or replace function public.opciones_punto(p_gid integer)
returns table(uso_grupo text, contrato_id uuid, contrato text, mantenedor_id uuid, mantenedor text, estado text, n_luminarias integer)
language sql stable security definer set search_path to 'public'
as $function$
  select pm.uso_grupo, pm.contrato_id, c.nombre, pm.mantenedor_id,
         coalesce(m.nombre, case when pm.estado = 'sin_mantencion' and upper(pm.mantenimiento) like '% / EN RECEPCION' then 'EN RECEPCION' end),
         pm.estado, pm.n_luminarias
    from public.puntos_luminarios p
    join public.puntos_mantenimiento pm on pm.llave = p.llave
    left join public.contratos   c on c.id = pm.contrato_id
    left join public.mantenedores m on m.id = pm.mantenedor_id
   where p.gid = p_gid
   order by pm.uso_grupo, c.nombre, m.nombre;
$function$;

create or replace function public.luminarias_punto(p_gid integer)
returns table(modelo text, potencia integer, uso text, uso_grupo text, contrato_id uuid, contrato text,
              mantenedor_id uuid, mantenedor text, estado text, n integer)
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(nullif(btrim(l.modelo), ''), nullif(btrim(l.tipo_lum), ''), 'Sin modelo'),
         l.potencia::int,
         coalesce(nullif(btrim(l.uso), ''), 'Sin uso'),
         coalesce(l.uso_grupo, 'OTRO'),
         r.contrato_id, c.nombre, r.mantenedor_id,
         coalesce(m.nombre, case when r.estado = 'sin_mantencion' and upper(btrim(l.mantenedor)) = 'EN RECEPCION' then 'EN RECEPCION' end),
         r.estado,
         count(*)::int
    from public.puntos_luminarios p
    join public.luminarias l on l.llave = p.llave
    cross join lateral public.resolver_mantencion(l.contrato, l.mantenedor, l.mantenimiento) r
    left join public.contratos    c on c.id = r.contrato_id
    left join public.mantenedores m on m.id = r.mantenedor_id
   where p.gid = p_gid
   group by 1, 2, 3, 4, r.contrato_id, c.nombre, r.mantenedor_id, m.nombre, r.estado, 8
   order by 4, 3, 2 desc nulls last, 1;
$function$;

create or replace function public.estado_mantencion_circuito(p_gid integer)
returns text
language sql stable security definer set search_path to 'public'
as $function$
  select case when mant_estado = 'sin_mantencion' and upper(btrim(coalesce(mantenedor, ''))) = 'EN RECEPCION' then 'recepcion'
              else coalesce(mant_estado, 'pendiente') end
    from public.circuitos where gid = p_gid;
$function$;
