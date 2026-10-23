-- Recalcular contrato y mantenedor de las fallas ya creadas: PASO 2, APLICA los cambios.
-- Ejecutar SOLO después de revisar 2026-10-mantenedor-recalcular-1-vista-previa.sql.
--
--  * Guarda primero un respaldo (respaldo_recalculo_contratos_20261022) con el contrato, mantenedor y fecha_actualizacion de TODAS
--    las fallas. Si se ejecuta dos veces, conserva el respaldo de la primera (el estado original).
--  * Solo cambia las fallas en las que la capa da una respuesta clara. Las ambiguas o sin mantenedor quedan como están.
--  * Las fallas en cascada siguen a la falla de su circuito (trigger existente).
--  * No mueve fecha_actualizacion (se apaga ese trigger durante el cambio) y no dispara notificaciones: solo cambian
--    contrato y mantenedor, no la asignación ni el estado.
--  * Cambiar el contrato de una falla abierta cambia quién la ve (la restricción por contrato es inmediata). Las que ya
--    estaban asignadas a un camión de otro contrato conviene revisarlas con la columna "cambian_abiertas_con_camion_asignado"
--    de la vista previa.
--
-- Para deshacer: ver el bloque comentado al final.

begin;

create table if not exists public.respaldo_recalculo_contratos_20261022 as
  select id, contrato_id, mantenedor, fecha_actualizacion, now() as respaldado_en from public.fallas;
alter table public.respaldo_recalculo_contratos_20261022 enable row level security;

alter table public.fallas disable trigger trg_fallas_actualizacion;

update public.fallas f
   set contrato_id = n.r_contrato,
       mantenedor  = n.r_mantenedor
  from (
    select f2.id, a.r_contrato, a.r_mantenedor
      from public.fallas f2
      cross join lateral (
        select * from public.asignacion_de_punto(f2.ref_punto_gid, public.uso_de_codigo(f2.tipo_falla)) where f2.tipo = 'punto'
        union all
        select * from public.asignacion_de_circuito(f2.ref_circuito_gid) where f2.tipo = 'linea'
      ) a
     where not coalesce(f2.cascada, false)
  ) n
 where f.id = n.id
   and (f.contrato_id is distinct from n.r_contrato or f.mantenedor is distinct from n.r_mantenedor);

alter table public.fallas enable trigger trg_fallas_actualizacion;

-- Resultado: cuántas fallas quedaron en cada contrato y mantenedor.
select coalesce(k.nombre, '(sin contrato)') as contrato, coalesce(f.mantenedor, '(sin mantenedor)') as mantenedor, count(*) as fallas
  from public.fallas f
  left join public.contratos k on k.id = f.contrato_id
 group by 1, 2
 order by 3 desc;

commit;

-- ============ Deshacer (volver al estado del respaldo) ============
-- begin;
-- alter table public.fallas disable trigger trg_fallas_actualizacion;
-- update public.fallas f set contrato_id = r.contrato_id, mantenedor = r.mantenedor, fecha_actualizacion = r.fecha_actualizacion
--   from public.respaldo_recalculo_contratos_20261022 r where r.id = f.id;
-- alter table public.fallas enable trigger trg_fallas_actualizacion;
-- commit;
