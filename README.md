# Festa Manager

PWA per la gestione ordini di una festa di paese (sagra), con realtime tra cameriere / bar / cucina / admin.

Stack: **React + Vite + Tailwind CSS**, backend **Supabase** (Postgres + Realtime), deploy su **Vercel**.

---

## 1. Setup Supabase

1. Crea un progetto su [supabase.com](https://supabase.com).
2. Apri **SQL Editor** e incolla il contenuto di [`supabase_schema.sql`](./supabase_schema.sql). Esegui.
   - Crea le 4 tabelle (`users`, `menu_items`, `orders`, `order_items`)
   - Abilita la replica realtime su `orders` e `order_items`
   - Imposta RLS con policy pubbliche (auth Supabase non usata, login via PIN custom)
   - Inserisce utenti e menu di esempio
3. Dalla dashboard prendi `Project URL` e `anon public key`.

### PIN seed

| Ruolo     | Nome   | PIN     |
|-----------|--------|---------|
| Cameriere | Mario  | `1111`  |
| Cameriere | Giulia | `2222`  |
| Bar       | Luca   | `3333`  |
| Cucina    | Sara   | `4444`  |
| Admin     | Admin  | `999999`|

---

## 2. Setup locale

```bash
cd festa-manager
npm install
cp .env.example .env.local   # poi modifica con i tuoi valori Supabase
npm run dev
```

Apri http://localhost:5173

---

## 3. Deploy su Vercel

1. Push del repo su GitHub.
2. Su Vercel → "New Project" → seleziona il repo.
3. Framework preset: **Vite**. Build command: `npm run build`. Output dir: `dist`.
4. Imposta le **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy.

---

## 4. Struttura

```
festa-manager/
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── supabaseClient.js
│   ├── index.css
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   ├── CamerierePage.jsx
│   │   ├── BarPage.jsx
│   │   ├── CucinaPage.jsx
│   │   ├── StationPage.jsx     (base condivisa Bar/Cucina)
│   │   └── AdminPage.jsx
│   ├── components/
│   │   ├── PinPad.jsx
│   │   ├── MenuSelector.jsx
│   │   ├── OrderCard.jsx
│   │   └── TableBadge.jsx
│   └── hooks/
│       └── useOrders.js
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── .env.local
└── supabase_schema.sql
```

---

## 5. Icone PWA

Inserire in `public/`:

- `pwa-192x192.png` (192×192)
- `pwa-512x512.png` (512×512)

Senza queste due immagini la PWA è comunque installabile, ma l'icona del manifest verrà mostrata come placeholder dal browser.

---

## 6. Note

- L'autenticazione è basata su PIN custom (nessuna Supabase Auth). I PIN sono memorizzati in chiaro su DB: ambiente locale di sagra, non un sistema multitenant.
- L'utente loggato viene salvato in `localStorage` come `festaUser`.
- I tasti hanno altezza minima 48px e dark mode predefinita (lettura facilitata in ambienti a luce bassa).
