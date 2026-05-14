-- =============================================
-- Festa Manager — Migration v4
-- Fasce orarie servizio, messaggio benvenuto staff.
-- Solo dati: nessuna nuova tabella, nessuna ALTER schema.
--
-- Esegui questo file nell'SQL Editor di Supabase.
-- IDEMPOTENTE: puoi rieseguirlo senza danni.
-- =============================================

begin;

-- =============================================
-- 1. FASCE ORARIE
-- =============================================
-- 4 fasce: colazione / pranzo / aperitivo / cena.
-- Per ogni fascia: attiva (bool), inizio (HH:MM), fine (HH:MM).
-- L'orario "fine" puo' essere oltre mezzanotte (es. cena 18:00 -> 02:00).

insert into impostazioni (chiave, valore) values
  ('fascia_colazione_attiva',  'false'),
  ('fascia_colazione_inizio',  '07:00'),
  ('fascia_colazione_fine',    '10:30'),

  ('fascia_pranzo_attiva',     'true'),
  ('fascia_pranzo_inizio',     '11:00'),
  ('fascia_pranzo_fine',       '16:00'),

  ('fascia_aperitivo_attiva',  'false'),
  ('fascia_aperitivo_inizio',  '17:00'),
  ('fascia_aperitivo_fine',    '19:00'),

  ('fascia_cena_attiva',       'true'),
  ('fascia_cena_inizio',       '18:00'),
  ('fascia_cena_fine',         '02:00')
on conflict (chiave) do nothing;

-- =============================================
-- 2. MESSAGGIO DI BENVENUTO STAFF
-- =============================================
-- Testo usato dall'admin per invitare lo staff via WhatsApp.
-- Salvato in singola riga (senza newline reali) per evitare problemi
-- di encoding nel link wa.me; l'admin puo' poi editarlo dalla UI.

insert into impostazioni (chiave, valore) values
  ('messaggio_benvenuto',
   'Ciao! Sei stato invitato a fare parte dello staff per la nostra sagra. Accedi all''app usando il link e il tuo PIN personale. Buon lavoro! 🎪')
on conflict (chiave) do nothing;

commit;

-- =============================================
-- QUERY DI VERIFICA POST-MIGRATION
-- =============================================

-- 1) Fasce orarie caricate
-- select chiave, valore from impostazioni
-- where chiave like 'fascia_%' order by chiave;

-- 2) Messaggio benvenuto caricato
-- select valore from impostazioni where chiave = 'messaggio_benvenuto';

-- 3) Conteggio totale impostazioni
-- select count(*) from impostazioni;
