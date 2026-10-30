-- 103 monopostes nuevos (sin luminarias registradas) pasan a Elecnor/Sinec el 1-nov-2026 junto con el cambio Clever -> Sinec.
-- (Ya aplicado en Supabase.) La lista queda en monopostes_1nov; aplicar_cambio_clever_a_sinec() (trabajo programado
-- cambio_clever_sinec, 00:00 del 1-nov) les agrega una luminaria vial provisoria Elecnor/Sinec si siguen sin luminarias.
-- Ojo: la próxima carga de Luminaria.gpkg reemplaza la tabla luminarias; para conservarlos deben venir en la capa.
create table if not exists public.monopostes_1nov (llave integer primary key);
alter table public.monopostes_1nov enable row level security;
-- (la función aplicar_cambio_clever_a_sinec() está definida en Supabase; ver la migración monopostes_nuevos_desde_1_nov)
