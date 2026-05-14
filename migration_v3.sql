-- =============================================
-- Festa Manager — Migration v3
-- Sottocategorie su menu_items, mandata M4, timer mandate.
--
-- Esegui questo file nell'SQL Editor di Supabase.
-- IDEMPOTENTE: puoi rieseguirlo senza danni.
-- =============================================

begin;

-- =============================================
-- 1. MENU_ITEMS — sottocategoria
-- =============================================
-- Per i piatti cucina la sottocategoria diventa la fonte autoritativa
-- per determinare la mandata di default (antipasto->M1, primo->M2,
-- secondo|contorno->M3, dolce->M4).
-- Per i bar la mandata resta derivata da ordine (>=40 = M4 caffe'/amari).

alter table menu_items add column if not exists sottocategoria text;

alter table menu_items drop constraint if exists menu_items_sottocategoria_check;
alter table menu_items add constraint menu_items_sottocategoria_check
  check (sottocategoria is null
         or sottocategoria in ('antipasto','primo','secondo','contorno','dolce'));

-- Popola le sottocategorie esistenti in base alla fascia `ordine`.
-- Solo dove ancora NULL (idempotente: una seconda esecuzione non
-- sovrascrive cambi manuali fatti via admin).
update menu_items
set sottocategoria = 'antipasto'
where categoria = 'cucina' and ordine between 1 and 9
  and sottocategoria is null;

update menu_items
set sottocategoria = 'primo'
where categoria = 'cucina' and ordine between 10 and 19
  and sottocategoria is null;

update menu_items
set sottocategoria = 'secondo'
where categoria = 'cucina' and ordine between 20 and 29
  and sottocategoria is null;

update menu_items
set sottocategoria = 'dolce'
where categoria = 'cucina' and ordine between 30 and 39
  and sottocategoria is null;

update menu_items
set sottocategoria = 'contorno'
where categoria = 'cucina' and ordine between 40 and 49
  and sottocategoria is null;

-- Indice utile per filtri/groupBy
create index if not exists idx_menu_items_sottocategoria on menu_items(sottocategoria);

-- =============================================
-- 2. IMPOSTAZIONI — timer tra mandate
-- =============================================

insert into impostazioni (chiave, valore) values
  ('tempo_timer_mandate_min', '10')
on conflict (chiave) do nothing;

commit;

-- =============================================
-- QUERY DI VERIFICA POST-MIGRATION
-- =============================================

-- 1) Sottocategorie popolate
-- select sottocategoria, count(*) from menu_items
-- where categoria = 'cucina' group by sottocategoria order by sottocategoria;

-- 2) Eventuali piatti cucina ancora senza sottocategoria (vanno sistemati a mano via admin)
-- select id, nome, ordine from menu_items
-- where categoria = 'cucina' and sottocategoria is null;

-- 3) Timer caricato
-- select * from impostazioni where chiave = 'tempo_timer_mandate_min';

-- 4) Constraint attivo
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'menu_items'::regclass and contype = 'c';
