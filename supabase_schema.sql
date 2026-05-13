-- =============================================
-- Festa Manager — schema Supabase
-- Esegui questo file nell'SQL Editor di Supabase
-- =============================================

-- Estensioni
create extension if not exists "pgcrypto";

-- ---------- TABELLE ----------

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ruolo text not null check (ruolo in ('cameriere','bar','cucina','admin')),
  pin text not null unique,
  created_at timestamptz default now()
);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  prezzo numeric(6,2) not null,
  categoria text not null check (categoria in ('cucina','bar')),
  attivo boolean default true,
  ordine integer default 0
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  numero_tavolo integer not null,
  n_persone integer not null default 1,
  stato text not null default 'aperto'
    check (stato in ('aperto','cucina_pronta','bar_pronto','completo','pagato')),
  totale numeric(8,2) not null default 0,
  note text,
  created_at timestamptz default now(),
  pagato_at timestamptz
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  item_id uuid references menu_items(id),
  nome_item text not null,
  categoria text not null,
  quantita integer not null default 1,
  prezzo_unitario numeric(6,2) not null,
  pronto boolean default false
);

-- Indici utili
create index if not exists idx_orders_stato on orders(stato);
create index if not exists idx_order_items_order_id on order_items(order_id);
create index if not exists idx_order_items_categoria on order_items(categoria);
create index if not exists idx_order_items_pronto on order_items(pronto);

-- ---------- REALTIME ----------
-- Abilita la replica sulle tabelle che ci servono live.
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;

-- ---------- RLS ----------
-- Auth Supabase NON usata: usiamo PIN custom.
-- Quindi attiviamo RLS ma con policy permissive (public read/write).
-- Cambiare in produzione se necessario.

alter table users       enable row level security;
alter table menu_items  enable row level security;
alter table orders      enable row level security;
alter table order_items enable row level security;

-- users
drop policy if exists "public read users"  on users;
drop policy if exists "public write users" on users;
create policy "public read users"  on users for select using (true);
create policy "public write users" on users for all    using (true) with check (true);

-- menu_items
drop policy if exists "public read menu"  on menu_items;
drop policy if exists "public write menu" on menu_items;
create policy "public read menu"  on menu_items for select using (true);
create policy "public write menu" on menu_items for all    using (true) with check (true);

-- orders
drop policy if exists "public read orders"  on orders;
drop policy if exists "public write orders" on orders;
create policy "public read orders"  on orders for select using (true);
create policy "public write orders" on orders for all    using (true) with check (true);

-- order_items
drop policy if exists "public read order_items"  on order_items;
drop policy if exists "public write order_items" on order_items;
create policy "public read order_items"  on order_items for select using (true);
create policy "public write order_items" on order_items for all    using (true) with check (true);

-- =============================================
-- SEED
-- =============================================

-- Utenti di esempio
insert into users (nome, ruolo, pin) values
  ('Mario',  'cameriere', '1111'),
  ('Giulia', 'cameriere', '2222'),
  ('Luca',   'bar',       '3333'),
  ('Sara',   'cucina',    '4444'),
  ('Admin',  'admin',     '999999')
on conflict (pin) do nothing;

-- Menu cucina
insert into menu_items (nome, prezzo, categoria, ordine) values
  ('Primo piatto',   8.00, 'cucina', 1),
  ('Secondo piatto', 10.00,'cucina', 2),
  ('Contorno',       3.00, 'cucina', 3),
  ('Pane',           1.00, 'cucina', 4),
  ('Dolce',          4.00, 'cucina', 5);

-- Menu bar
insert into menu_items (nome, prezzo, categoria, ordine) values
  ('Acqua naturale',      1.00, 'bar', 1),
  ('Acqua frizzante',     1.00, 'bar', 2),
  ('Vino rosso (calice)', 2.50, 'bar', 3),
  ('Vino bianco (calice)',2.50, 'bar', 4),
  ('Birra',               3.00, 'bar', 5),
  ('Bibita',              2.00, 'bar', 6),
  ('Caffè',               1.50, 'bar', 7);
