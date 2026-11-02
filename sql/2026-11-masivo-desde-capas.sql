-- Masivo desde las capas (aplicado en Supabase el 2026-11-02)
-- Añade luminarias.masivo y circuitos.masivo (se cargan desde la columna MASIVO de las capas) y
-- hace que marcar_masivo_ex_clever lea esas columnas en vez de las tablas ex_clever_*.
-- Ver la migración "masivo_desde_capas" para el cuerpo completo de la función.
alter table public.luminarias add column if not exists masivo boolean not null default false;
alter table public.circuitos  add column if not exists masivo boolean not null default false;
