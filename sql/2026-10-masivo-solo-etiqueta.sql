-- Masivo pasa a ser SOLO una etiqueta para filtrar: ya no elige ni cambia el contrato de la falla.
-- (Ya aplicado en Supabase.) La etiqueta la pone solo el trigger trg_y_masivo_ex_clever (sql/2026-10-masivo-ex-clever.sql).
drop trigger if exists trg_z_contrato_por_defecto_upd on public.fallas;
drop function if exists public.contrato_por_defecto_update();

create or replace function public.contrato_por_defecto_insert()
returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  -- falla sin derivación (sin luminarias registradas): contrato por defecto único, sin mirar masivo
  if new.contrato_id is null and not coalesce(new.cascada, false) and new.derivacion is null then
    select id into new.contrato_id from public.contratos where defecto_para = 'normal' and activo limit 1;
  end if;
  return new;
end $function$;

-- el contrato «por defecto de Masivo» deja de existir
update public.contratos set defecto_para = null where defecto_para = 'masivo';
