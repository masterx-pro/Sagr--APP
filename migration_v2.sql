-- =============================================
-- Festa Manager — Migration v2
-- Cambia il modello dati: stati ordine, nome cliente, mandate,
-- ruolo cassa, tabella impostazioni timer.
--
-- Esegui questo file nell'SQL Editor di Supabase.
-- È IDEMPOTENTE: puoi rieseguirlo senza danni.
-- =============================================

begin;

-- =============================================
-- 1. ORDERS — nuovi stati
-- =============================================

-- Rimuovo vecchio constraint
alter table orders drop constraint if exists orders_stato_check;

-- Migro i dati esistenti ai nuovi stati.
-- 'pagato'        -> 'confermato' (in v1 era lo stato finale attivo)
-- 'completo'      -> 'confermato' (legacy)
-- 'aperto'        -> 'confermato' (legacy, in v1 in pratica già pagato)
-- 'cucina_pronta' -> 'confermato' (legacy)
-- 'bar_pronto'    -> 'confermato' (legacy)
update orders
set stato = 'confermato'
where stato in ('pagato','completo','aperto','cucina_pronta','bar_pronto');

-- Nuovo default semantico per ordini creati senza stato esplicito
alter table orders alter column stato set default 'bozza';

-- Ricreo constraint con i nuovi stati
alter table orders add constraint orders_stato_check
  check (stato in ('bozza','attesa_cassa','confermato','stornato','completato'));

-- =============================================
-- 2. ORDERS — nuovi campi
-- =============================================

-- Nome del cliente / capotavola (obbligatorio lato app, lasciato nullable
-- in DB per non rompere i record storici)
alter table orders add column if not exists nome_cliente text;

-- Tipo pagamento
alter table orders add column if not exists tipo_pagamento text;
alter table orders drop constraint if exists orders_tipo_pagamento_check;
alter table orders add constraint orders_tipo_pagamento_check
  check (tipo_pagamento is null or tipo_pagamento in ('bancomat','contanti'));

-- Cameriere che ha aperto l'ordine (nome denormalizzato per UI veloce)
alter table orders add column if not exists cameriere_nome text;

-- FK opzionale al cameriere; on delete set null per non rompere ordini storici
alter table orders add column if not exists cameriere_id uuid;
alter table orders drop constraint if exists orders_cameriere_id_fkey;
alter table orders add constraint orders_cameriere_id_fkey
  foreign key (cameriere_id) references users(id) on delete set null;

-- Storno
alter table orders add column if not exists stornato_at timestamptz;
alter table orders add column if not exists storno_note text;

-- Nota: i campi legacy `servizio` e `turno` restano in tabella per
-- compatibilità con i dati storici, ma il codice v2 non li usa più
-- (il sistema turni è stato rimosso).

-- =============================================
-- 3. ORDER_ITEMS — mandate
-- =============================================

alter table order_items add column if not exists mandata integer not null default 1;

alter table order_items add column if not exists mandata_stato text not null default 'in_attesa';
alter table order_items drop constraint if exists order_items_mandata_stato_check;
alter table order_items add constraint order_items_mandata_stato_check
  check (mandata_stato in ('in_attesa','in_preparazione','pronta','consegnata','in_pausa'));

alter table order_items add column if not exists mandata_inviata_at    timestamptz;
alter table order_items add column if not exists mandata_pronta_at     timestamptz;
alter table order_items add column if not exists mandata_consegnata_at timestamptz;

-- Allineamento dati storici: gli items già con pronto=true sono stati
-- portati al tavolo in v1, quindi semanticamente sono 'consegnata' in v2.
update order_items
set mandata_stato = 'consegnata',
    mandata_consegnata_at = coalesce(mandata_consegnata_at, now())
where pronto = true and mandata_stato = 'in_attesa';

-- =============================================
-- 4. USERS — ruolo cassa
-- =============================================

alter table users drop constraint if exists users_ruolo_check;
alter table users add constraint users_ruolo_check
  check (ruolo in ('cameriere','bar','cucina','admin','cassa'));

-- Utente cassa di esempio (PIN 4 cifre)
insert into users (nome, ruolo, pin)
values ('Cassa', 'cassa', '0000')
on conflict (pin) do nothing;

-- =============================================
-- 5. TABELLA IMPOSTAZIONI — timer mandate
-- =============================================

create table if not exists impostazioni (
  id uuid primary key default gen_random_uuid(),
  chiave text unique not null,
  valore text not null,
  updated_at timestamptz default now()
);

insert into impostazioni (chiave, valore) values
  ('tempo_consegna_min',            '5'),
  ('tempo_consumo_antipasto_min',  '15'),
  ('tempo_consumo_primo_min',      '20'),
  ('tempo_consumo_secondo_min',    '25'),
  ('tempo_consumo_dolce_min',      '10'),
  ('tempo_preparazione_cucina_min','15')
on conflict (chiave) do nothing;

-- RLS permissivo (coerente con le altre tabelle: auth via PIN custom)
alter table impostazioni enable row level security;

drop policy if exists "public read impostazioni"  on impostazioni;
drop policy if exists "public write impostazioni" on impostazioni;
create policy "public read impostazioni"  on impostazioni for select using (true);
create policy "public write impostazioni" on impostazioni for all    using (true) with check (true);

-- =============================================
-- 6. INDICI AGGIUNTIVI
-- =============================================

create index if not exists idx_order_items_mandata        on order_items(mandata);
create index if not exists idx_order_items_mandata_stato  on order_items(mandata_stato);
create index if not exists idx_orders_nome_cliente        on orders(nome_cliente);
create index if not exists idx_orders_tipo_pagamento      on orders(tipo_pagamento);

commit;

-- =============================================
-- QUERY DI VERIFICA POST-MIGRATION
-- Esegui questi SELECT (uno alla volta) per controllare l'esito.
-- =============================================

-- 1) Distribuzione stati ordini (deve contenere solo i nuovi valori)
-- select stato, count(*) from orders group by stato order by stato;

-- 2) Constraint attivi su orders / order_items / users
-- select conrelid::regclass as tabella, conname, pg_get_constraintdef(oid) as definizione
-- from pg_constraint
-- where conrelid in ('orders'::regclass, 'order_items'::regclass, 'users'::regclass)
--   and contype = 'c'
-- order by tabella, conname;

-- 3) Utente cassa creato
-- select nome, ruolo, pin from users where ruolo = 'cassa';

-- 4) Impostazioni timer caricate
-- select chiave, valore from impostazioni order by chiave;

-- 5) Distribuzione mandate
-- select mandata, mandata_stato, count(*) from order_items
-- group by mandata, mandata_stato order by mandata, mandata_stato;

-- 6) Colonne nuove presenti su orders
-- select column_name, data_type from information_schema.columns
-- where table_name='orders' and column_name in
--   ('nome_cliente','tipo_pagamento','cameriere_nome','cameriere_id','stornato_at','storno_note');
