-- =============================================
-- Setup utenti per stress test
-- Esegui questo file nell'SQL Editor di Supabase prima del test.
-- IDEMPOTENTE: e' sicuro rieseguirlo.
-- =============================================

-- 1. INSERT degli utenti che mancano. ON CONFLICT (pin) DO NOTHING
--    evita duplicati ma NON aggiorna i nomi esistenti.
insert into users (nome, ruolo, pin) values
  ('Mario',   'cameriere', '1111'),
  ('Giulia',  'cameriere', '2222'),
  ('Carlo',   'cameriere', '1234'),
  ('Anna',    'cameriere', '5678'),
  ('Piero',   'cameriere', '9123'),
  ('Rosa',    'cameriere', '4567'),
  ('Luigi',   'cameriere', '1357'),
  ('Marta',   'cameriere', '2468'),
  ('Enzo',    'cameriere', '3691'),
  ('Carla',   'cameriere', '4802'),
  ('Cucina1', 'cucina',    '4444'),
  ('Cucina2', 'cucina',    '4445'),
  ('Bar1',    'bar',       '3333'),
  ('Bar2',    'bar',       '3334'),
  ('Cassa',   'cassa',     '0000')
on conflict (pin) do nothing;

-- 2. UPDATE dei PIN che esistevano gia' con nomi diversi
--    (allineamento ai nomi del prompt stress test).
update users set nome = 'Carlo',   ruolo = 'cameriere' where pin = '1234';
update users set nome = 'Anna',    ruolo = 'cameriere' where pin = '5678';
update users set nome = 'Piero',   ruolo = 'cameriere' where pin = '9123';
update users set nome = 'Rosa',    ruolo = 'cameriere' where pin = '4567';
update users set nome = 'Cucina1', ruolo = 'cucina'    where pin = '4444';
update users set nome = 'Bar1',    ruolo = 'bar'       where pin = '3333';

-- =============================================
-- Verifica post-esecuzione
-- =============================================
-- select ruolo, nome, pin from users order by ruolo, pin;
