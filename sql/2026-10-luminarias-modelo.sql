-- Modelo de la luminaria (campo MODELO de Luminaria.gpkg: VIENTO, ROLLE, TECEO…).
-- Hasta ahora solo se guardaba TIPO_LUM (LED/HM/NA). Se agrega la columna y luminarias_punto devuelve el modelo.
-- Mientras la columna esté vacía (antes de volver a cargar con actualizar_capas_v5.py) se muestra el tipo, como hasta ahora.
-- Se puede ejecutar más de una vez.
alter table public.luminarias add column if not exists modelo text;

create or replace function public.luminarias_punto(p_gid integer)
returns table(modelo text, potencia integer, uso text, uso_grupo text,
              contrato_id uuid, contrato text, mantenedor_id uuid, mantenedor text,
              estado text, n integer)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(l.modelo), ''), nullif(btrim(l.tipo_lum), ''), 'Sin modelo'),
         l.potencia::int,
         coalesce(nullif(btrim(l.uso), ''), 'Sin uso'),
         coalesce(l.uso_grupo, 'OTRO'),
         e.contrato_id, c.nombre, e.mantenedor_id, m.nombre,
         case when e.sin_mantencion then 'sin_mantencion'
              when e.contrato_id is not null and e.mantenedor_id is not null then 'ok'
              else 'pendiente' end,
         count(*)::int
    from public.puntos_luminarios p
    join public.luminarias l on l.llave = p.llave
    left join public.mantenimiento_equivalencias e on e.texto = upper(trim(l.mantenimiento))
    left join public.contratos c on c.id = e.contrato_id
    left join public.mantenedores m on m.id = e.mantenedor_id
   where p.gid = p_gid
   group by 1, 2, 3, 4, e.contrato_id, c.nombre, e.mantenedor_id, m.nombre, e.sin_mantencion
   order by 4, 3, 2 desc nulls last, 1;
$$;
revoke all on function public.luminarias_punto(integer) from public, anon;
grant execute on function public.luminarias_punto(integer) to authenticated;
