-- =============================================
-- Festa Manager — Migration v6
-- Aggiunge lo stato ordine 'attesa_bancomat': ordine creato con
-- pagamento bancomat ma non ancora confermato dal cameriere.
-- Il cameriere preme un secondo CTA "Pagamento effettuato" dopo
-- aver visto la transazione sul POS; a quel punto l'ordine passa
-- a 'confermato' e la mandata M1 (bar + cucina) viene sbloccata.
--
-- Esegui questo file nell'SQL Editor di Supabase.
-- È IDEMPOTENTE: puoi rieseguirlo senza danni.
-- =============================================

begin;

-- Sostituisco il constraint stati ordine aggiungendo 'attesa_bancomat'.
-- Tutti gli stati precedenti restano validi.
alter table orders drop constraint if exists orders_stato_check;
alter table orders add constraint orders_stato_check
  check (stato in (
    'bozza',
    'attesa_cassa',
    'attesa_bancomat',
    'confermato',
    'stornato',
    'completato'
  ));

commit;

-- =============================================
-- QUERY DI VERIFICA POST-MIGRATION
-- =============================================

-- 1) Constraint aggiornato
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'orders'::regclass and conname = 'orders_stato_check';

-- 2) Eventuali ordini gia' in attesa_bancomat (dovrebbe essere 0 finche'
--    il codice applicativo non viene rilasciato)
-- select count(*) from orders where stato = 'attesa_bancomat';
