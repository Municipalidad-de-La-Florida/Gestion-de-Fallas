-- Segunda falla en el mismo punto: se permite una falla activa por luminaria/uso (vial, peatonal) en cada punto.
-- 1) La base lo exige: no se puede crear una falla activa si el punto ya tiene otra del mismo uso
--    (o si alguna de las dos no tiene uso registrado: se considera que cubre todo el punto, como hasta ahora).
-- 2) «Reiterada» se calcula por uso: reparar la vial no vuelve reiterada a una falla nueva de la peatonal.
-- Se puede ejecutar más de una vez.

create or replace function public.validar_una_falla_activa_por_uso()
returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.tipo = 'punto' and coalesce(new.cascada, false) = false and new.ref_punto_gid is not null
     and new.estado is distinct from 'reparada' then
    if exists (
      select 1 from public.fallas f
       where f.tipo = 'punto' and f.cascada = false and f.ref_punto_gid = new.ref_punto_gid
         and f.estado <> 'reparada' and f.id is distinct from new.id
         and (f.uso_grupo is null or new.uso_grupo is null or f.uso_grupo = new.uso_grupo)
    ) then
      raise exception 'Este punto ya tiene una falla activa de esa luminaria (o uso)';
    end if;
  end if;
  return new;
end $function$;
drop trigger if exists trg_validar_una_falla_activa_por_uso on public.fallas;
create trigger trg_validar_una_falla_activa_por_uso before insert on public.fallas
  for each row execute function public.validar_una_falla_activa_por_uso();

create or replace function public.detectar_reiterada()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare
  fecha_reparacion_anterior timestamptz;
begin
  if new.cascada = false and new.estado = 'reportada' then
    if new.tipo = 'punto' then
      select r.fecha_reparacion into fecha_reparacion_anterior
      from public.fallas f
      join public.reparaciones r on r.falla_id = f.id
      where f.tipo = 'punto' and f.ref_punto_gid = new.ref_punto_gid
        and f.estado = 'reparada'
        and (new.uso_grupo is null or f.uso_grupo is null or f.uso_grupo = new.uso_grupo)
      order by r.fecha_reparacion desc limit 1;
    elsif new.tipo = 'linea' then
      select r.fecha_reparacion into fecha_reparacion_anterior
      from public.fallas f
      join public.reparaciones r on r.falla_id = f.id
      where f.tipo = 'linea' and f.ref_circuito_gid = new.ref_circuito_gid
        and f.estado = 'reparada'
      order by r.fecha_reparacion desc limit 1;
    end if;

    if fecha_reparacion_anterior is not null
       and new.fecha_falla - fecha_reparacion_anterior <= interval '40 days'
       and new.fecha_falla >= fecha_reparacion_anterior then
      new.estado := 'reiterada';
      new.es_reiterada := true;
    end if;
  end if;
  return new;
end;
$function$;

-- Comprobación: debe devolver 2 filas
select tgname from pg_trigger where tgrelid = 'public.fallas'::regclass and tgname in ('trg_validar_una_falla_activa_por_uso', 'trg_detectar_reiterada');
