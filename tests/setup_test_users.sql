-- Camerieri di test per stress.spec.js
-- I PIN 1111 e 2222 esistono gia' (Mario e Giulia).
-- Aggiungo i 4 PIN mancanti usati dal test.
insert into users (nome, ruolo, pin) values
  ('Test Marco',  'cameriere', '1234'),
  ('Test Sara2',  'cameriere', '5678'),
  ('Test Luca2',  'cameriere', '9123'),
  ('Test Anna',   'cameriere', '4567')
on conflict (pin) do nothing;

-- Verifica:
-- select nome, ruolo, pin from users where ruolo='cameriere' order by pin;
