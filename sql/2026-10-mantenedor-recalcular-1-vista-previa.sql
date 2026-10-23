-- Recalcular contrato y mantenedor de las fallas ya creadas: PASO 1, solo lectura (no modifica nada).
-- Requiere haber ejecutado 2026-10-mantenedor-luminarias.sql y cargado las capas con actualizar_capas_v3.py.
-- Muestra qué pasaría con las fallas existentes (sin las de cascada, que siguen a su circuito) si se aplica la regla nueva.
-- Las fallas que la capa no puede resolver (ambiguas o sin mantenedor) NO se tocan: quedan como están.

-- A. Resumen por tipo de falla.
with nuevo as (
  select f.id, f.tipo, f.estado, f.contrato_id as contrato_actual, f.asignado_camion_id, a.r_contrato, a.r_mantenedor
    from public.fallas f
    left join lateral (
      select * from public.asignacion_de_punto(f.ref_punto_gid, public.uso_de_codigo(f.tipo_falla)) where f.tipo = 'punto'
      union all
      select * from public.asignacion_de_circuito(f.ref_circuito_gid) where f.tipo = 'linea'
    ) a on true
   where not coalesce(f.cascada, false)
)
select tipo,
       count(*) as fallas,
       count(*) filter (where r_contrato is null) as sin_resolver_quedan_como_estan,
       count(*) filter (where r_contrato is not null and r_contrato = contrato_actual) as ya_estaban_bien,
       count(*) filter (where r_contrato is not null and r_contrato is distinct from contrato_actual) as cambian_de_contrato,
       count(*) filter (where r_contrato is not null and r_contrato is distinct from contrato_actual and estado <> 'reparada') as cambian_y_estan_abiertas,
       count(*) filter (where r_contrato is not null and r_contrato is distinct from contrato_actual and estado <> 'reparada'
                          and asignado_camion_id is not null) as cambian_abiertas_con_camion_asignado
  from nuevo
 group by tipo
 order by tipo;

-- B. De qué contrato a cuál pasarían (y con qué mantenedor).
with nuevo as (
  select f.contrato_id as contrato_actual, a.r_contrato, a.r_mantenedor
    from public.fallas f
    cross join lateral (
      select * from public.asignacion_de_punto(f.ref_punto_gid, public.uso_de_codigo(f.tipo_falla)) where f.tipo = 'punto'
      union all
      select * from public.asignacion_de_circuito(f.ref_circuito_gid) where f.tipo = 'linea'
    ) a
   where not coalesce(f.cascada, false)
)
select coalesce(k0.nombre, '(sin contrato)') as contrato_actual,
       k1.nombre as contrato_nuevo,
       coalesce(n.r_mantenedor, '(sin mantenedor)') as mantenedor_nuevo,
       count(*) as fallas
  from nuevo n
  left join public.contratos k0 on k0.id = n.contrato_actual
  join public.contratos k1 on k1.id = n.r_contrato
 group by 1, 2, 3
 order by 4 desc;

-- C. Las que NO se pueden resolver con la capa (para revisarlas a mano), con su número de OT.
select f.ot, f.tipo, f.tipo_falla, f.estado, k.nombre as contrato_actual, p.llave, ci.id as circuito
  from public.fallas f
  left join public.contratos k on k.id = f.contrato_id
  left join public.puntos_luminarios p on p.gid = f.ref_punto_gid
  left join public.circuitos ci on ci.gid = f.ref_circuito_gid
 where not coalesce(f.cascada, false)
   and not exists (
     select 1 from (
       select * from public.asignacion_de_punto(f.ref_punto_gid, public.uso_de_codigo(f.tipo_falla)) where f.tipo = 'punto'
       union all
       select * from public.asignacion_de_circuito(f.ref_circuito_gid) where f.tipo = 'linea'
     ) a)
 order by f.fecha_falla_real desc
 limit 200;
