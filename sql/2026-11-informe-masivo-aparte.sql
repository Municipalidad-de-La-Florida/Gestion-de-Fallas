-- Informe de reparaciones: los masivos salen como informe aparte («Sinec - Contrato Elecnor #Masivo»).
-- p_pares ahora admite "masivo": true|false por par; sin esa clave se incluye todo (compatibilidad).

create or replace function public.informe_reparaciones_opciones()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso('informe_reparaciones') then
    raise exception 'No tienes permiso para sacar el informe de reparaciones';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'contrato_id', x.contrato_id, 'contrato', c.nombre, 'contrato_completo', coalesce(c.nombre_completo, c.nombre),
             'mantenedor_id', x.mantenedor_id, 'mantenedor', m.nombre, 'masivo', x.masivo)
           order by c.nombre, m.nombre nulls last, x.masivo)
    from (select distinct f.contrato_id, f.mantenedor_id, coalesce(f.masivo, false) as masivo
            from public.fallas f join public.reparaciones r on r.falla_id = f.id
           where f.cascada is not true and f.contrato_id is not null
             and public.falla_visible(f.contrato_id, f.mantenedor_id)) x
    join public.contratos c on c.id = x.contrato_id
    left join public.mantenedores m on m.id = x.mantenedor_id
  ), '[]'::jsonb);
end $$;
revoke all on function public.informe_reparaciones_opciones() from public, anon;
grant execute on function public.informe_reparaciones_opciones() to authenticated;

do $$ declare d text; begin
  select pg_get_functiondef('public.informe_reparaciones(date,date,jsonb,uuid[],integer)'::regprocedure) into d;
  d := replace(d, 'where f.cascada is not true and f.contrato_id = v_c and f.mantenedor_id is not distinct from v_m',
    'where f.cascada is not true and f.contrato_id = v_c and f.mantenedor_id is not distinct from v_m and (not (par ? ''masivo'') or coalesce(f.masivo, false) = coalesce((par->>''masivo'')::boolean, false))');
  d := replace(d, '''contrato_id'', v_c, ''mantenedor_id'', v_m,',
    '''contrato_id'', v_c, ''mantenedor_id'', v_m, ''masivo'', case when par ? ''masivo'' then coalesce((par->>''masivo'')::boolean, false) end,');
  execute d;
end $$;
