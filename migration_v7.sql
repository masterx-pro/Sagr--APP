-- =============================================
-- Festa Manager — Migration v7
-- Aggiunge le impostazioni per la "chiamata automatica mandate":
-- quando attiva, il sistema sblocca la mandata successiva un tot di
-- minuti dopo che la precedente e' stata marcata consegnata, senza
-- richiedere il click manuale del cameriere sul pulsante "Esci con MX".
--
-- I valori sono in MINUTI. Default conservativi: l'admin li tara in UI
-- dalla sezione "Chiamata automatica mandate" (tab Impostazioni).
--
-- Esegui questo file nell'SQL Editor di Supabase.
-- È IDEMPOTENTE: puoi rieseguirlo senza danni.
-- =============================================

begin;

insert into impostazioni (chiave, valore) values
  ('chiamata_automatica_attiva', 'false'),
  ('chiamata_auto_m1_min',       '15'),
  ('chiamata_auto_m2_min',       '20'),
  ('chiamata_auto_m3_min',       '15')
on conflict (chiave) do nothing;

commit;

-- =============================================
-- QUERY DI VERIFICA POST-MIGRATION
-- =============================================

-- 1) Le 4 nuove chiavi sono presenti
-- select chiave, valore from impostazioni
-- where chiave in (
--   'chiamata_automatica_attiva',
--   'chiamata_auto_m1_min',
--   'chiamata_auto_m2_min',
--   'chiamata_auto_m3_min'
-- ) order by chiave;

-- 2) Conteggio totale impostazioni
-- select count(*) from impostazioni;
