-- =============================================
-- Festa Manager — Migration v5
-- KDS riprogettato: sblocco mandate, pre-riscaldo, "in finestra",
-- magazzino porzioni su menu_items, timer pre-riscaldo cucina.
--
-- Esegui questo file nell'SQL Editor di Supabase.
-- IDEMPOTENTE: puoi rieseguirlo senza danni.
--
-- ⚠️ MIGRAZIONE DATI: lo stato `pronta` (v2-v4) è stato sostituito da
-- `in_finestra` nel nuovo modello. Tutti i record esistenti con
-- mandata_stato='pronta' vengono migrati a 'in_finestra' PRIMA che il
-- nuovo CHECK constraint entri in vigore, altrimenti il vincolo fallisce.
-- =============================================

begin;

-- =============================================
-- 0. PRE-MIGRAZIONE: stato 'pronta' → 'in_finestra'
-- =============================================
-- Va fatto PRIMA di toccare il constraint, altrimenti il nuovo CHECK
-- rifiuta le righe legacy. mandata_pronta_at viene "promosso" a
-- in_finestra_at (la colonna non esiste ancora: aggiungiamo la colonna
-- prima, poi copiamo).

alter table order_items
  add column if not exists pre_riscaldo_at  timestamptz,
  add column if not exists sbloccata_at     timestamptz,
  add column if not exists in_finestra_at   timestamptz;

-- Copia il timestamp "pronta" sul nuovo timestamp "in finestra".
-- Solo dove in_finestra_at è ancora NULL (idempotente).
update order_items
set in_finestra_at = mandata_pronta_at
where mandata_stato = 'pronta'
  and in_finestra_at is null;

-- Ora migra lo stato. Solo i record che usano il vecchio valore.
update order_items
set mandata_stato = 'in_finestra'
where mandata_stato = 'pronta';

-- =============================================
-- 1. ORDER_ITEMS — nuovo CHECK su mandata_stato
-- =============================================
-- Nuovo flusso end-to-end (v5):
--   in_attesa       → mandata creata, in coda. Nessuna azione.
--   pre_riscaldo    → timer scattato (dopo che la M precedente è andata
--                     "in finestra"); la cucina può iniziare a riscaldare.
--   sbloccata       → cameriere ha premuto "Esci con MN": URGENTE.
--   in_preparazione → cucina ha preso in carico la mandata.
--   in_finestra     → impiattato e in finestra; attende il cameriere.
--   consegnata      → cameriere ha portato al tavolo.
--   in_pausa        → ordine stornato; lavori sospesi.

alter table order_items drop constraint if exists order_items_mandata_stato_check;
alter table order_items add constraint order_items_mandata_stato_check
  check (mandata_stato in (
    'in_attesa',
    'pre_riscaldo',
    'sbloccata',
    'in_preparazione',
    'in_finestra',
    'consegnata',
    'in_pausa'
  ));

-- Indice già presente da v2 (idx_order_items_mandata_stato) — coprirà
-- anche i nuovi valori senza modifiche.

-- =============================================
-- 2. IMPOSTAZIONI — timer pre-riscaldo per portata
-- =============================================
-- Minuti tra "M(N-1) in finestra" e "inizio pre-riscaldo M(N)".
-- Default conservativi: l'admin può tararli in UI.

insert into impostazioni (chiave, valore) values
  ('pre_riscaldo_antipasto_min', '10'),
  ('pre_riscaldo_primo_min',     '15'),
  ('pre_riscaldo_secondo_min',   '15'),
  ('pre_riscaldo_contorno_min',  '12'),
  ('pre_riscaldo_dolce_min',     '8')
on conflict (chiave) do nothing;

-- =============================================
-- 3. MENU_ITEMS — magazzino porzioni
-- =============================================
-- Flag opt-in per piatto: se traccia_magazzino=false (default) il piatto
-- si comporta come prima (porzioni infinite).
--   porzioni_totali       → quante porzioni preparate per il servizio
--   porzioni_disponibili  → quante ne restano (decrementa al createOrder)
--   soglia_alert          → sotto questa soglia il piatto mostra alert
--                           in cameriere + admin; sotto soglia/2 alert rosso.

alter table menu_items
  add column if not exists porzioni_totali       integer,
  add column if not exists porzioni_disponibili  integer,
  add column if not exists soglia_alert          integer default 20,
  add column if not exists traccia_magazzino     boolean default false;

-- Sanity: porzioni_disponibili non può essere negativo.
-- Permettiamo NULL (= non tracciato).
alter table menu_items drop constraint if exists menu_items_porzioni_check;
alter table menu_items add constraint menu_items_porzioni_check
  check (porzioni_disponibili is null or porzioni_disponibili >= 0);

alter table menu_items drop constraint if exists menu_items_porzioni_totali_check;
alter table menu_items add constraint menu_items_porzioni_totali_check
  check (porzioni_totali is null or porzioni_totali >= 0);

alter table menu_items drop constraint if exists menu_items_soglia_alert_check;
alter table menu_items add constraint menu_items_soglia_alert_check
  check (soglia_alert is null or soglia_alert >= 0);

-- Indice parziale per query "alert magazzino":
-- SELECT * FROM menu_items WHERE traccia_magazzino AND porzioni_disponibili <= soglia_alert
create index if not exists idx_menu_items_traccia_magazzino
  on menu_items(traccia_magazzino)
  where traccia_magazzino = true;

commit;

-- =============================================
-- QUERY DI VERIFICA POST-MIGRATION
-- =============================================

-- 1) Nessun record con stato legacy 'pronta'
-- select count(*) as legacy_pronta_rows
-- from order_items where mandata_stato = 'pronta';

-- 2) Distribuzione nuovi stati mandata
-- select mandata_stato, count(*)
-- from order_items
-- group by mandata_stato order by mandata_stato;

-- 3) Constraint attivo aggiornato
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'order_items'::regclass
--   and conname = 'order_items_mandata_stato_check';

-- 4) Nuove colonne presenti su order_items
-- select column_name, data_type from information_schema.columns
-- where table_name = 'order_items'
--   and column_name in ('pre_riscaldo_at','sbloccata_at','in_finestra_at');

-- 5) Nuove colonne presenti su menu_items
-- select column_name, data_type, column_default from information_schema.columns
-- where table_name = 'menu_items'
--   and column_name in ('porzioni_totali','porzioni_disponibili','soglia_alert','traccia_magazzino');

-- 6) Impostazioni timer pre-riscaldo caricate
-- select chiave, valore from impostazioni
-- where chiave like 'pre_riscaldo_%_min' order by chiave;

-- 7) Spot check: items con pre_riscaldo / sbloccata / in_finestra timestamps
-- select mandata_stato, count(*) filter (where pre_riscaldo_at is not null) as con_preriscaldo,
--                       count(*) filter (where sbloccata_at    is not null) as con_sblocco,
--                       count(*) filter (where in_finestra_at  is not null) as con_finestra
-- from order_items group by mandata_stato order by mandata_stato;
