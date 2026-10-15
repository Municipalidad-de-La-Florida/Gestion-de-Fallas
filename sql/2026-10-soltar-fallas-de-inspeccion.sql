-- Dejar sueltas algunas fallas de una inspección (solo admin).
-- Las fallas elegidas (y los puntos en cascada de los circuitos elegidos) quedan sin inspección, conservando OS,
-- fecha, hora, estado y quién las ingresó. La inspección se mantiene con el resto de sus fallas.
-- Después se pueden volver a agrupar con «Armar inspección con fallas sueltas».
-- Ejecutar completo en el SQL Editor (elegir "Run without RLS" si pregunta). Idempotente.

create or replace function public.soltar_fallas_de_inspeccion(p_inspeccion uuid, p_fallas uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer; v_c integer;
begin
  if public.mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede usar esta herramienta.';
  end if;
  if p_fallas is null or coalesce(array_length(p_fallas, 1), 0) = 0 then
    raise exception 'No hay fallas seleccionadas.';
  end if;
  if not exists (select 1 from public.inspecciones where id = p_inspeccion) then
    raise exception 'La inspección no existe.';
  end if;

  -- Los puntos en cascada primero (se identifican por el circuito de origen, que aún está en la inspección)
  update public.fallas set inspeccion_id = null
   where inspeccion_id = p_inspeccion and cascada = true
     and circuito_origen_id in (select id from public.fallas where id = any(p_fallas) and inspeccion_id = p_inspeccion and cascada = false);
  get diagnostics v_c = row_count;

  update public.fallas set inspeccion_id = null
   where id = any(p_fallas) and inspeccion_id = p_inspeccion and cascada = false;
  get diagnostics v_n = row_count;

  return jsonb_build_object('sueltas', v_n, 'cascada', v_c);
end $$;
revoke all on function public.soltar_fallas_de_inspeccion(uuid, uuid[]) from public, anon;
grant execute on function public.soltar_fallas_de_inspeccion(uuid, uuid[]) to authenticated;

-- Comprobación: debe devolver 1 fila
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'soltar_fallas_de_inspeccion';
