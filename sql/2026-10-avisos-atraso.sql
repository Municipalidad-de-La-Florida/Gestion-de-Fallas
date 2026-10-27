-- Avisos de atraso para mantenedores (Sinec, Clever) y camiones.
-- Plazo contractual: reportadas/reiteradas 24 h (atraso desde las 48 h = 1 día); pendientes 96 h (atraso desde las 120 h = 1 día).
-- Cada día que pasa se avisa de nuevo ("La falla OS 26-0370 tiene 2 días de atraso") y el aviso anterior de esa falla se reemplaza.

create table if not exists public.atraso_avisos (        -- último día de atraso avisado por falla (no se toca la tabla fallas)
  falla_id uuid primary key references public.fallas(id) on delete cascade,
  dias integer not null,
  avisado_en timestamptz not null default now()
);
alter table public.atraso_avisos enable row level security;   -- sin políticas: solo la usa la función

create table if not exists public.notificaciones_atraso (  -- lista que se ve desde la campana de la web
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  falla_id uuid not null references public.fallas(id) on delete cascade,
  dias integer not null,
  mensaje text not null,
  creado_en timestamptz not null default now(),
  leida boolean not null default false,
  unique (usuario_id, falla_id)                           -- una sola por falla: el aviso nuevo reemplaza al anterior
);
alter table public.notificaciones_atraso enable row level security;
drop policy if exists notif_atraso_select on public.notificaciones_atraso;
drop policy if exists notif_atraso_update on public.notificaciones_atraso;
drop policy if exists notif_atraso_delete on public.notificaciones_atraso;
create policy notif_atraso_select on public.notificaciones_atraso for select to authenticated using (usuario_id = (select auth.uid()));
create policy notif_atraso_update on public.notificaciones_atraso for update to authenticated using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));
create policy notif_atraso_delete on public.notificaciones_atraso for delete to authenticated using (usuario_id = (select auth.uid()));
revoke all on public.notificaciones_atraso from anon;
grant select, update, delete on public.notificaciones_atraso to authenticated;

-- Días de atraso de una falla (0 = sin atraso)
create or replace function public.dias_atraso_falla(p_estado text, p_base timestamptz)
returns integer language sql immutable as $$
  select case
    when p_base is null then 0
    when p_estado = 'pendiente' then case when now() - p_base >= interval '120 hours' then floor(extract(epoch from now() - p_base) / 86400)::int - 4 else 0 end
    when p_estado in ('reportada', 'reiterada') then case when now() - p_base >= interval '48 hours' then floor(extract(epoch from now() - p_base) / 86400)::int - 1 else 0 end
    else 0 end;
$$;

-- Revisa las fallas abiertas y avisa cuando una cumple un día más de atraso.
-- p_push = false: solo llena la campana (sirve para la primera vez, sin mandar una avalancha de avisos al celular).
create or replace function public.avisar_atrasos(p_push boolean default true)
returns integer language plpgsql security definer set search_path = public as $$
declare f record; v_dias int; v_dest uuid[]; v_msg text; v_n int := 0;
begin
  for f in
    select fa.id, fa.ot, fa.estado, fa.contrato_id, fa.mantenedor_id, fa.asignado_camion_id,
           case when fa.estado = 'pendiente' then coalesce(fa.fecha_falla_real, fa.fecha_falla, fa.fecha_pendiente)
                else coalesce(fa.fecha_falla_real, fa.fecha_falla) end as base,
           coalesce(av.dias, 0) as avisado
      from public.fallas fa
      left join public.atraso_avisos av on av.falla_id = fa.id
     where fa.estado in ('reportada', 'reiterada', 'pendiente') and fa.cascada is not true
  loop
    v_dias := public.dias_atraso_falla(f.estado, f.base);
    if v_dias <= 0 then
      if f.avisado > 0 then
        delete from public.notificaciones_atraso where falla_id = f.id;
        delete from public.atraso_avisos where falla_id = f.id;
      end if;
      continue;
    end if;
    if v_dias <= f.avisado then continue; end if;

    select array_agg(distinct x.id) into v_dest from (
      select u.id from public.usuarios u
       where u.rol in ('contratista', 'contratista2', 'contratista3')
         and ((f.mantenedor_id is not null and exists (select 1 from public.usuario_mantenedores um where um.usuario_id = u.id and um.mantenedor_id = f.mantenedor_id))
              or (f.mantenedor_id is null and public.usuario_cubre_legado(u.id, f.contrato_id)))
      union
      select u.id from public.usuarios u where u.id = f.asignado_camion_id and u.rol = 'camion'
    ) x;
    if v_dest is null then continue; end if;

    v_msg := 'La falla OS ' || coalesce(f.ot, '') || ' tiene ' || v_dias || case when v_dias = 1 then ' día' else ' días' end || ' de atraso';
    insert into public.notificaciones_atraso (usuario_id, falla_id, dias, mensaje, creado_en, leida)
      select d, f.id, v_dias, v_msg, now(), false from unnest(v_dest) d
      on conflict (usuario_id, falla_id) do update
        set dias = excluded.dias, mensaje = excluded.mensaje, creado_en = excluded.creado_en, leida = false;
    insert into public.atraso_avisos (falla_id, dias, avisado_en) values (f.id, v_dias, now())
      on conflict (falla_id) do update set dias = excluded.dias, avisado_en = excluded.avisado_en;
    if p_push then
      perform public.notificar_push(v_dest, 'Falla atrasada', v_msg, './?falla=' || f.id);
    end if;
    v_n := v_n + 1;
  end loop;

  -- Fallas que ya no están abiertas: se descartan sus avisos
  delete from public.notificaciones_atraso n using public.fallas fa
   where fa.id = n.falla_id and fa.estado not in ('reportada', 'reiterada', 'pendiente');
  return v_n;
end $$;
revoke all on function public.avisar_atrasos(boolean) from public, anon, authenticated;

-- Primera pasada sin push (llena la campana) y revisión cada hora
select public.avisar_atrasos(false);
select cron.unschedule('avisar-atrasos') where exists (select 1 from cron.job where jobname = 'avisar-atrasos');
select cron.schedule('avisar-atrasos', '5 * * * *', 'select public.avisar_atrasos(true)');
