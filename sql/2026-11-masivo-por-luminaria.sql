-- Masivo según la luminaria elegida (puntos con dos luminarias del mismo contrato/mantenedor, una Masivo y otra no).
-- La app, al elegir la luminaria, envía p_lum_masivo; la falla lo guarda y el tag Masivo sale de ahí.
alter table public.fallas add column if not exists lum_masivo boolean;

drop function if exists public.luminarias_punto(integer);
create function public.luminarias_punto(p_gid integer)
returns table(modelo text, potencia integer, uso text, uso_grupo text, contrato_id uuid, contrato text,
              mantenedor_id uuid, mantenedor text, estado text, n integer, masivo boolean)
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(nullif(btrim(l.modelo), ''), nullif(btrim(l.tipo_lum), ''), 'Sin modelo'),
         l.potencia::int,
         coalesce(nullif(btrim(l.uso), ''), 'Sin uso'),
         coalesce(l.uso_grupo, 'OTRO'),
         r.contrato_id, c.nombre, r.mantenedor_id,
         coalesce(m.nombre, case when r.estado = 'sin_mantencion' and upper(btrim(l.mantenedor)) = 'EN RECEPCION' then 'EN RECEPCION' end),
         r.estado,
         count(*)::int,
         coalesce(l.masivo, false)
    from public.puntos_luminarios p
    join public.luminarias l on l.llave = p.llave
    cross join lateral public.resolver_mantencion(l.contrato, l.mantenedor, l.mantenimiento) r
    left join public.contratos    c on c.id = r.contrato_id
    left join public.mantenedores m on m.id = r.mantenedor_id
   where p.gid = p_gid
   group by 1, 2, 3, 4, r.contrato_id, c.nombre, r.mantenedor_id, m.nombre, r.estado, 8, 11
   order by 4, 3, 2 desc nulls last, 1;
$function$;
revoke all on function public.luminarias_punto(integer) from public, anon;
grant execute on function public.luminarias_punto(integer) to authenticated;

-- crear_falla_punto: parámetro nuevo p_lum_masivo (cuerpo idéntico, guarda fallas.lum_masivo).
-- marcar_masivo_ex_clever: en fallas de punto, si lum_masivo no es nulo manda esa luminaria.
-- (Cuerpos completos: migración "masivo_por_luminaria" ya aplicada en Supabase.)
