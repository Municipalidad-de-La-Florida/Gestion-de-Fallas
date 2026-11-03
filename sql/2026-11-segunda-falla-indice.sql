-- Segunda falla en el mismo punto, corrección: había un índice único que permitía una sola falla abierta por punto
-- (fallas_punto_abierta_uk) y hacía fallar la segunda con «duplicate key value violates unique constraint».
-- Ahora es una por punto y uso (vial/peatonal). Los casos con uso vacío los cubre el trigger
-- trg_validar_una_falla_activa_por_uso (sql/2026-11-segunda-falla-punto.sql). Se puede ejecutar más de una vez.
drop index if exists public.fallas_punto_abierta_uk;
create unique index fallas_punto_abierta_uk on public.fallas (ref_punto_gid, coalesce(uso_grupo, ''))
  where tipo = 'punto' and cascada = false and estado in ('reportada', 'pendiente', 'reiterada');

-- Comprobación: debe devolver 1 fila
select indexname from pg_indexes where schemaname = 'public' and indexname = 'fallas_punto_abierta_uk';
