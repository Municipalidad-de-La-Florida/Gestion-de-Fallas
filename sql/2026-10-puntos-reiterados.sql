-- Los puntos de un circuito reiterado también quedan «reiterada» (se ven morados como el circuito).
-- Se puede ejecutar más de una vez.

-- 1) Los puntos nuevos de un circuito heredan el estado reiterada de su circuito.
create or replace function public.heredar_reiterada_cascada()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.cascada is true and new.circuito_origen_id is not null and new.estado = 'reportada'
     and exists (select 1 from public.fallas p where p.id = new.circuito_origen_id and p.estado = 'reiterada') then
    new.estado := 'reiterada';
    new.es_reiterada := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_heredar_reiterada_cascada on public.fallas;
create trigger trg_heredar_reiterada_cascada
  before insert on public.fallas
  for each row execute function public.heredar_reiterada_cascada();

-- 2) Corrige los puntos que ya existen (solo los que siguen «reportada» bajo un circuito reiterado).
update public.fallas c
   set estado = 'reiterada', es_reiterada = true
  from public.fallas p
 where c.cascada is true
   and c.estado = 'reportada'
   and p.id = c.circuito_origen_id
   and p.tipo = 'linea'
   and p.estado = 'reiterada';
