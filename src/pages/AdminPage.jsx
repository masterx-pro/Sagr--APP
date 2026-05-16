import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import { useExitConfirmGuard } from '../hooks/useExitConfirmGuard.js'
import { useImpostazioni } from '../context/ImpostazioniContext.jsx'
import OrderCard from '../components/OrderCard.jsx'
import ServizioBadge from '../components/ServizioBadge.jsx'
import { getServizioAttuale, rangeOrdinePerSottocategoria } from '../utils/servizio.js'

const SOTTOCATEGORIE_CUCINA = ['antipasto', 'primo', 'secondo', 'contorno', 'dolce']

const STATI_ORDINE = ['bozza', 'attesa_cassa', 'confermato', 'stornato', 'completato']

const STATO_LABEL_BREVE = {
  bozza:        'Bozza',
  attesa_cassa: 'In cassa',
  confermato:   'Confermati',
  stornato:     'Stornati',
  completato:   'Completati',
}

/**
 * AdminPage v2: tab Ordini, Menu, Riepilogo, Staff, Impostazioni.
 */
export default function AdminPage({ user, onLogout }) {
  useExitConfirmGuard(onLogout)
  const [tab, setTab] = useState('ordini')
  const { impostazioni } = useImpostazioni()

  // Servizio "interno" (pranzo/cena) per filtri ordini.
  // Risolto via fasce orarie quando disponibili, altrimenti fallback orario.
  const [servizioCorrente, setServizioCorrente] = useState(() => getServizioAttuale(impostazioni))
  useEffect(() => {
    const nuovo = getServizioAttuale(impostazioni)
    if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
  }, [impostazioni])
  useEffect(() => {
    const interval = setInterval(() => {
      const nuovo = getServizioAttuale(impostazioni)
      if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
    }, 60_000)
    return () => clearInterval(interval)
  }, [servizioCorrente, impostazioni])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-admin px-4 py-3 flex items-center justify-between
                         sticky top-0 z-30 mobile-landscape:py-2">
        <div className="min-w-0">
          <h1 className="font-bold text-lg mobile-landscape:text-base">Admin</h1>
          <p className="text-xs opacity-90 truncate mobile-landscape:hidden">{user.nome}</p>
        </div>
        <div className="flex items-center gap-2">
          <ServizioBadge impostazioni={impostazioni} />
          <button
            onClick={onLogout}
            className="px-3 py-2 rounded-lg bg-white/20 text-sm font-semibold"
          >
            Esci
          </button>
        </div>
      </header>

      <nav className="grid grid-cols-5 gap-1 p-2 bg-pannello border-b border-bordo
                      sticky top-[3.25rem] z-20 mobile-landscape:top-[2.5rem]
                      mobile-landscape:p-1">
        <TabBtn active={tab === 'ordini'}       onClick={() => setTab('ordini')}>Ordini</TabBtn>
        <TabBtn active={tab === 'menu'}         onClick={() => setTab('menu')}>Menu</TabBtn>
        <TabBtn active={tab === 'riepilogo'}    onClick={() => setTab('riepilogo')}>Riepilogo</TabBtn>
        <TabBtn active={tab === 'staff'}        onClick={() => setTab('staff')}>Staff</TabBtn>
        <TabBtn active={tab === 'impostazioni'} onClick={() => setTab('impostazioni')}>⚙️</TabBtn>
      </nav>

      <main className="flex-1 p-4 mobile-landscape:p-3">
        {tab === 'ordini'       && <TabOrdini />}
        {tab === 'menu'         && <TabMenu />}
        {tab === 'riepilogo'    && <TabRiepilogo />}
        {tab === 'staff'        && <TabStaff />}
        {tab === 'impostazioni' && <TabImpostazioni />}
      </main>
    </div>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-btn rounded-xl font-semibold text-sm sm:text-base
                  mobile-landscape:min-h-[36px] mobile-landscape:rounded-lg
                  mobile-landscape:text-xs ${
        active ? 'bg-admin text-white' : 'bg-sfondo border border-bordo'
      }`}
    >
      {children}
    </button>
  )
}

// -------------------- TAB ORDINI --------------------

function TabOrdini() {
  const { orders, fetchAllOrders, deleteOrder } = useOrders()
  const [filtroStato, setFiltroStato] = useState('tutti')
  const [filtroServizio, setFiltroServizio] = useState('tutti')

  useEffect(() => {
    fetchAllOrders()
    // orders: '*' (admin vede insert/update/delete). order_items: solo UPDATE
    // (gli INSERT triggerano sempre anche un UPDATE su orders.totale).
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },
        () => fetchAllOrders())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_items' },
        () => fetchAllOrders())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchAllOrders])

  const handleDelete = async (id) => {
    if (!confirm('Eliminare definitivamente questo ordine?')) return
    try {
      await deleteOrder(id)
      await fetchAllOrders()
    } catch (e) {
      alert('Errore: ' + (e.message || e))
    }
  }

  let filtrati = orders
  if (filtroStato !== 'tutti') filtrati = filtrati.filter(o => o.stato === filtroStato)
  if (filtroServizio !== 'tutti') filtrati = filtrati.filter(o => o.servizio === filtroServizio)

  const conteggi = STATI_ORDINE.reduce((acc, s) => {
    acc[s] = orders.filter(o => o.stato === s).length
    return acc
  }, {})

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <FiltroBtn active={filtroServizio === 'tutti'}  onClick={() => setFiltroServizio('tutti')}>
          Tutti ({orders.length})
        </FiltroBtn>
        <FiltroBtn active={filtroServizio === 'pranzo'} onClick={() => setFiltroServizio('pranzo')}>
          🌞 Pranzo ({orders.filter(o => o.servizio === 'pranzo').length})
        </FiltroBtn>
        <FiltroBtn active={filtroServizio === 'cena'}   onClick={() => setFiltroServizio('cena')}>
          🌙 Cena ({orders.filter(o => o.servizio === 'cena').length})
        </FiltroBtn>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <FiltroBtn active={filtroStato === 'tutti'} onClick={() => setFiltroStato('tutti')}>
          Tutti
        </FiltroBtn>
        {STATI_ORDINE.map(s => (
          <FiltroBtn key={s} active={filtroStato === s} onClick={() => setFiltroStato(s)}>
            {STATO_LABEL_BREVE[s]} ({conteggi[s] || 0})
          </FiltroBtn>
        ))}
      </div>

      {filtrati.length === 0 ? (
        <p className="text-center opacity-60 py-8">Nessun ordine</p>
      ) : (
        filtrati.map(o => (
          <OrderCard
            key={o.id}
            order={o}
            items={o.order_items || []}
            onDelete={handleDelete}
          />
        ))
      )}
    </div>
  )
}

function FiltroBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-btn rounded-xl font-semibold text-xs sm:text-sm px-2 ${
        active ? 'bg-admin text-white' : 'bg-pannello border border-bordo'
      }`}
    >
      {children}
    </button>
  )
}

// -------------------- TAB MENU --------------------

function TabMenu() {
  const [items, setItems] = useState([])
  const [nome, setNome] = useState('')
  const [prezzo, setPrezzo] = useState('')
  const [categoria, setCategoria] = useState('cucina')
  const [sottocategoria, setSottocategoria] = useState('antipasto')
  const [editingId, setEditingId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    setRefreshing(true)
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .order('categoria')
      .order('ordine')
    setItems(data || [])
    setRefreshing(false)
  }
  useEffect(() => { load() }, [])

  const toggleAttivo = async (item) => {
    await supabase
      .from('menu_items')
      .update({ attivo: !item.attivo })
      .eq('id', item.id)
    load()
  }

  // Calcola il prossimo `ordine` libero nel range della sottocategoria,
  // basandosi sugli items gia' presenti in quella sottocategoria.
  function calcolaOrdineAuto(categoria, sotto) {
    if (categoria !== 'cucina') {
      // Bar: append in coda
      const used = items.filter(i => i.categoria === 'bar').map(i => i.ordine ?? 0)
      return (used.length ? Math.max(...used) : 0) + 1
    }
    const range = rangeOrdinePerSottocategoria(sotto)
    if (!range) return 99
    const [lo, hi] = range
    const used = new Set(items
      .filter(i => i.categoria === 'cucina' && i.ordine >= lo && i.ordine <= hi)
      .map(i => i.ordine))
    for (let o = lo; o <= hi; o++) if (!used.has(o)) return o
    return hi // saturato: appiccico in fondo (admin lo aggiustera')
  }

  const aggiungi = async (e) => {
    e.preventDefault()
    const p = parseFloat(prezzo.replace(',', '.'))
    if (!nome.trim() || isNaN(p) || p < 0) {
      alert('Compila nome e prezzo validi')
      return
    }
    if (categoria === 'cucina' && !SOTTOCATEGORIE_CUCINA.includes(sottocategoria)) {
      alert('Sottocategoria cucina non valida')
      return
    }
    const ordine = calcolaOrdineAuto(categoria, sottocategoria)
    const insertObj = {
      nome: nome.trim(),
      prezzo: p,
      categoria,
      ordine,
    }
    if (categoria === 'cucina') insertObj.sottocategoria = sottocategoria
    const { error } = await supabase.from('menu_items').insert(insertObj)
    if (error) { alert(error.message); return }
    setNome(''); setPrezzo('')
    load()
  }

  const salvaModifica = async (id, patch) => {
    const { error } = await supabase
      .from('menu_items')
      .update(patch)
      .eq('id', id)
    if (error) { alert(error.message); return }
    setEditingId(null)
    load()
  }

  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center justify-between">
        <span className="text-sm opacity-70">Gestione menu</span>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          aria-label="Ricarica menu"
          title="Ricarica menu"
          className={`w-9 h-9 rounded-lg bg-pannello border border-bordo text-base
                      flex items-center justify-center
                      active:scale-95 transition-transform
                      disabled:opacity-50 ${refreshing ? 'animate-spin' : ''}`}
        >
          🔄
        </button>
      </div>

      <form onSubmit={aggiungi} className="card space-y-2">
        <h3 className="font-bold">Aggiungi voce</h3>
        <input
          className="input-base"
          placeholder="Nome (es. Patatine)"
          value={nome}
          onChange={e => setNome(e.target.value)}
        />
        <input
          className="input-base"
          placeholder="Prezzo (es. 3.50)"
          inputMode="decimal"
          value={prezzo}
          onChange={e => setPrezzo(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setCategoria('cucina')}
            className={`min-h-btn rounded-xl font-semibold ${
              categoria === 'cucina' ? 'bg-cucina' : 'bg-pannello border border-bordo'
            }`}
          >
            Cucina
          </button>
          <button
            type="button"
            onClick={() => setCategoria('bar')}
            className={`min-h-btn rounded-xl font-semibold ${
              categoria === 'bar' ? 'bg-bar' : 'bg-pannello border border-bordo'
            }`}
          >
            Bar
          </button>
        </div>

        {categoria === 'cucina' && (
          <label className="block">
            <span className="text-xs opacity-80">Sottocategoria *</span>
            <select
              className="input-base mt-1"
              value={sottocategoria}
              onChange={e => setSottocategoria(e.target.value)}
            >
              <option value="antipasto">Antipasto</option>
              <option value="primo">Primo</option>
              <option value="secondo">Secondo</option>
              <option value="contorno">Contorno</option>
              <option value="dolce">Dolce</option>
            </select>
          </label>
        )}

        <button type="submit" className="btn-success w-full">Aggiungi</button>
      </form>

      <ListaMenu
        titolo="Cucina"
        colore="text-cucina"
        items={cucinaItems}
        onToggle={toggleAttivo}
        editingId={editingId}
        onEdit={setEditingId}
        onSave={salvaModifica}
        portate={PORTATE_CUCINA}
      />
      <ListaMenu
        titolo="Bar"
        colore="text-bar"
        items={barItems}
        onToggle={toggleAttivo}
        editingId={editingId}
        onEdit={setEditingId}
        onSave={salvaModifica}
        portate={PORTATE_BAR}
      />
    </div>
  )
}

const PORTATE_CUCINA = [
  { label: 'Antipasti', test: o => o >= 1  && o <= 9  },
  { label: 'Primi',     test: o => o >= 10 && o <= 19 },
  { label: 'Secondi',   test: o => o >= 20 && o <= 29 },
  { label: 'Contorni',  test: o => o >= 40 && o <= 49 },
  { label: 'Dolci',     test: o => o >= 30 && o <= 39 },
]

const PORTATE_BAR = [
  { label: 'Acqua',                   test: o => o >= 1  && o <= 9  },
  { label: 'Vino sfuso',              test: o => o >= 10 && o <= 19 },
  { label: 'Verdicchio',              test: o => o >= 20 && o <= 29 },
  { label: "Lacrima di Morro d'Alba", test: o => o >= 30 && o <= 39 },
  { label: 'Caffè',                   test: o => o >= 40 && o <= 49 },
  { label: 'Amari',                   test: o => o >= 50 && o <= 59 },
]

function groupByPortata(items, schema) {
  const groups = schema.map(p => ({
    label: p.label,
    items: items.filter(i => p.test(i.ordine ?? 0)),
  }))
  const altro = items.filter(i => !schema.some(p => p.test(i.ordine ?? 0)))
  if (altro.length) groups.push({ label: 'Altro', items: altro })
  return groups.filter(g => g.items.length > 0)
}

function SeparatorePortata({ label }) {
  return (
    <li className="bg-black/40 border-y border-bordo py-2 text-center
                   text-sm font-bold uppercase tracking-widest opacity-90">
      — {label} —
    </li>
  )
}

function ListaMenu({ titolo, colore, items, onToggle, editingId, onEdit, onSave, portate }) {
  const renderItem = (i) => (
    <li key={i.id} className="card">
      {editingId === i.id ? (
        <FormModificaItem
          item={i}
          onSave={onSave}
          onCancel={() => onEdit(null)}
        />
      ) : (
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className={`font-semibold break-words whitespace-normal ${i.attivo ? '' : 'line-through opacity-50'}`}>
              {i.nome}
            </p>
            <p className="text-sm opacity-80">€ {Number(i.prezzo).toFixed(2)}</p>
          </div>
          <button
            onClick={() => onEdit(i.id)}
            className="px-3 py-2 rounded-xl text-sm font-semibold bg-pannello border border-bordo shrink-0"
          >
            Modifica
          </button>
          <button
            onClick={() => onToggle(i)}
            className={`px-3 py-2 rounded-xl text-sm font-semibold shrink-0 ${
              i.attivo ? 'bg-green-700' : 'bg-gray-600'
            }`}
          >
            {i.attivo ? 'Attivo' : 'Non attivo'}
          </button>
        </div>
      )}
    </li>
  )

  return (
    <div>
      <h3 className={`font-bold mb-2 ${colore}`}>{titolo}</h3>
      {items.length === 0 && (
        <p className="opacity-60 text-sm">Nessuna voce</p>
      )}
      <ul className="space-y-2">
        {portate
          ? groupByPortata(items, portate).flatMap(g => [
              <SeparatorePortata key={`hdr-${g.label}`} label={g.label} />,
              ...g.items.map(renderItem),
            ])
          : items.map(renderItem)}
      </ul>
    </div>
  )
}

function FormModificaItem({ item, onSave, onCancel }) {
  const [nome, setNome] = useState(item.nome)
  const [prezzo, setPrezzo] = useState(String(item.prezzo))
  const [categoria, setCategoria] = useState(item.categoria)
  const [sottocategoria, setSottocategoria] = useState(item.sottocategoria || 'antipasto')
  const [ordine, setOrdine] = useState(String(item.ordine ?? 0))
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const p = parseFloat(String(prezzo).replace(',', '.'))
    const o = parseInt(String(ordine), 10)
    if (!nome.trim() || isNaN(p) || p < 0) {
      alert('Compila nome e prezzo validi')
      return
    }
    setSaving(true)
    try {
      const patch = {
        nome: nome.trim(),
        prezzo: p,
        categoria,
        ordine: isNaN(o) ? 0 : o,
      }
      patch.sottocategoria = categoria === 'cucina' ? sottocategoria : null
      await onSave(item.id, patch)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block">
        <span className="text-xs opacity-80">Nome</span>
        <input
          className="input-base mt-1"
          value={nome}
          onChange={e => setNome(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="text-xs opacity-80">Prezzo</span>
        <input
          className="input-base mt-1"
          inputMode="decimal"
          value={prezzo}
          onChange={e => setPrezzo(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="text-xs opacity-80">Categoria</span>
        <select
          className="input-base mt-1"
          value={categoria}
          onChange={e => setCategoria(e.target.value)}
        >
          <option value="cucina">Cucina</option>
          <option value="bar">Bar</option>
        </select>
      </label>
      {categoria === 'cucina' && (
        <label className="block">
          <span className="text-xs opacity-80">Sottocategoria</span>
          <select
            className="input-base mt-1"
            value={sottocategoria}
            onChange={e => setSottocategoria(e.target.value)}
          >
            <option value="antipasto">Antipasto</option>
            <option value="primo">Primo</option>
            <option value="secondo">Secondo</option>
            <option value="contorno">Contorno</option>
            <option value="dolce">Dolce</option>
          </select>
        </label>
      )}
      <label className="block">
        <span className="text-xs opacity-80">Ordine (cucina: 1-9 antip, 10-19 primi, 20-29 sec, 30-39 dolci, 40-49 contorni; bar 40+ = caffè/amari)</span>
        <input
          className="input-base mt-1"
          inputMode="numeric"
          value={ordine}
          onChange={e => setOrdine(e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn-neutral"
        >
          Annulla
        </button>
        <button
          type="submit"
          disabled={saving}
          className="btn-success"
        >
          {saving ? 'Salvataggio…' : 'Salva'}
        </button>
      </div>
    </form>
  )
}

// -------------------- TAB RIEPILOGO --------------------

function TabRiepilogo() {
  const [stats, setStats] = useState(null)

  const load = async () => {
    const { data: tutti } = await supabase
      .from('orders')
      .select('id, numero_tavolo, n_persone, stato, totale, servizio, tipo_pagamento, order_items(nome_item, quantita)')

    if (!tutti) return

    // Considero come "incassati" gli ordini confermati + completati
    const incassati = tutti.filter(o => o.stato === 'confermato' || o.stato === 'completato')
    const aperti = tutti.filter(o => o.stato === 'bozza' || o.stato === 'attesa_cassa' || o.stato === 'stornato')

    const sum = (arr) => arr.reduce((s, o) => s + Number(o.totale || 0), 0)

    const incassoBancomat = sum(incassati.filter(o => o.tipo_pagamento === 'bancomat'))
    const incassoContanti = sum(incassati.filter(o => o.tipo_pagamento === 'contanti'))
    const incassoTotale   = sum(incassati)

    const incassoPranzo = sum(incassati.filter(o => o.servizio === 'pranzo'))
    const incassoCena   = sum(incassati.filter(o => o.servizio === 'cena'))

    const tavoliServiti = new Set(incassati.map(o => o.numero_tavolo)).size
    const personeServite = incassati.reduce((s, o) => s + (Number(o.n_persone) || 0), 0)

    const conteggio = new Map()
    for (const o of tutti) {
      for (const it of (o.order_items || [])) {
        conteggio.set(it.nome_item, (conteggio.get(it.nome_item) || 0) + it.quantita)
      }
    }
    const top5 = Array.from(conteggio.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    setStats({
      incassoTotale,
      incassoBancomat, incassoContanti,
      incassoPranzo, incassoCena,
      tavoliServiti,
      personeServite,
      ordiniAperti: aperti.length,
      top5,
    })
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('admin-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_items' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  if (!stats) {
    return <p className="text-center opacity-60 py-8">Caricamento…</p>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="💳 Bancomat"      value={`€ ${stats.incassoBancomat.toFixed(2)}`} />
        <StatCard label="💵 Contanti"      value={`€ ${stats.incassoContanti.toFixed(2)}`} />
        <StatCard label="🌞 Pranzo"        value={`€ ${stats.incassoPranzo.toFixed(2)}`} />
        <StatCard label="🌙 Cena"          value={`€ ${stats.incassoCena.toFixed(2)}`} />
        <StatCard label="Totale incasso"   value={`€ ${stats.incassoTotale.toFixed(2)}`} />
        <StatCard label="Tavoli serviti"   value={stats.tavoliServiti} />
        <StatCard label="👥 Persone servite" value={stats.personeServite} />
        <StatCard label="Ordini aperti"    value={stats.ordiniAperti} />
      </div>

      <div>
        <h3 className="font-bold mb-2">Top 5 prodotti</h3>
        {stats.top5.length === 0 ? (
          <p className="opacity-60 text-sm">Nessun dato</p>
        ) : (
          <ol className="space-y-2">
            {stats.top5.map(([nome, q], i) => (
              <li key={nome} className="card flex items-center justify-between">
                <span className="font-semibold">{i + 1}. {nome}</span>
                <span className="font-bold text-xl">× {q}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="card">
      <p className="text-xs opacity-70">{label}</p>
      <p className="text-2xl font-extrabold">{value}</p>
    </div>
  )
}

// -------------------- TAB STAFF --------------------

const RUOLI = ['cameriere', 'bar', 'cucina', 'cassa', 'admin']

const PIN_LEN = (ruolo) => (ruolo === 'admin' ? 6 : 4)

const RUOLO_BG = {
  cameriere: 'bg-cameriere',
  bar:       'bg-bar',
  cucina:    'bg-cucina',
  cassa:     'bg-cassa',
  admin:     'bg-admin',
}

function TabStaff() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [reveal, setReveal] = useState({})
  const [messaggioBenvenuto, setMessaggioBenvenuto] = useState('')

  const load = async () => {
    setLoading(true)
    const [usersRes, impRes] = await Promise.all([
      supabase.from('users').select('id, nome, ruolo, pin').order('ruolo').order('nome'),
      supabase.from('impostazioni').select('valore').eq('chiave', 'messaggio_benvenuto').maybeSingle(),
    ])
    if (usersRes.error) alert('Errore caricamento utenti: ' + usersRes.error.message)
    setUsers(usersRes.data || [])
    setMessaggioBenvenuto(impRes.data?.valore || 'Ciao! Sei stato invitato a fare parte dello staff per la nostra sagra.')
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const toggleReveal = (id) =>
    setReveal(r => ({ ...r, [id]: !r[id] }))

  const eliminaUtente = async (u) => {
    if (!confirm(`Sei sicuro di voler eliminare "${u.nome}"?`)) return
    const { error } = await supabase.from('users').delete().eq('id', u.id)
    if (error) { alert('Errore: ' + error.message); return }
    load()
  }

  const invitaWhatsApp = (u) => {
    const visibile = !!reveal[u.id]
    if (!visibile) {
      alert('Prima clicca sull\'occhio 👁 per vedere il PIN, poi invia l\'invito.')
      return
    }
    const linkApp = 'https://sagra-app-coral.vercel.app'
    const testo =
      `${messaggioBenvenuto}\n\n` +
      `🔗 Link app: ${linkApp}\n` +
      `🔑 Il tuo PIN: ${u.pin}\n` +
      `👤 Ruolo: ${u.ruolo}`
    const url = 'https://wa.me/?text=' + encodeURIComponent(testo)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center justify-between">
        <span className="text-sm opacity-70">Gestione staff</span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          aria-label="Ricarica utenti"
          title="Ricarica utenti"
          className={`w-9 h-9 rounded-lg bg-pannello border border-bordo text-base
                      flex items-center justify-center
                      active:scale-95 transition-transform
                      disabled:opacity-50 ${loading ? 'animate-spin' : ''}`}
        >
          🔄
        </button>
      </div>

      <FormAggiungiUtente users={users} onAdded={load} />

      <div>
        <h3 className="font-bold mb-2">Utenti ({users.length})</h3>
        {users.length === 0 && (
          <p className="opacity-60 text-sm">Nessun utente</p>
        )}
        <ul className="space-y-2">
          {users.map(u => {
            const visible = !!reveal[u.id]
            const bg = RUOLO_BG[u.ruolo] || 'bg-pannello'
            return (
              <li key={u.id} className="card flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold truncate">{u.nome}</p>
                    <span className={`badge ${bg} text-white text-xs px-2 py-0.5 rounded-full uppercase tracking-wide`}>
                      {u.ruolo}
                    </span>
                  </div>
                  <p className="text-sm opacity-80 font-mono">
                    PIN: {visible ? u.pin : '•'.repeat(String(u.pin || '').length || PIN_LEN(u.ruolo))}
                  </p>
                </div>
                <button
                  onClick={() => toggleReveal(u.id)}
                  aria-label={visible ? 'Nascondi PIN' : 'Mostra PIN'}
                  title={visible ? 'Nascondi PIN' : 'Mostra PIN'}
                  className="px-3 py-2 rounded-xl text-sm font-semibold bg-pannello border border-bordo"
                >
                  {visible ? '🙈' : '👁'}
                </button>
                <button
                  onClick={() => invitaWhatsApp(u)}
                  aria-label="Invita su WhatsApp"
                  title={visible ? 'Invita su WhatsApp' : 'Mostra prima il PIN'}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold ${
                    visible ? 'bg-emerald-700 text-white' : 'bg-pannello border border-bordo opacity-60'
                  }`}
                >
                  📱
                </button>
                <button
                  onClick={() => eliminaUtente(u)}
                  className="px-3 py-2 rounded-xl text-sm font-semibold bg-red-700"
                >
                  Elimina
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function FormAggiungiUtente({ users, onAdded }) {
  const [nome, setNome] = useState('')
  const [pin, setPin] = useState('')
  const [ruolo, setRuolo] = useState('cameriere')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const lenAttesa = PIN_LEN(ruolo)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)

    const nomeTrim = nome.trim()
    if (!nomeTrim) { setError('Nome obbligatorio'); return }
    if (!/^\d+$/.test(pin)) { setError('Il PIN deve contenere solo cifre'); return }
    if (pin.length !== lenAttesa) {
      setError(`Il PIN per "${ruolo}" deve essere di ${lenAttesa} cifre`)
      return
    }
    if (users.some(u => String(u.pin) === pin)) {
      setError('PIN già in uso')
      return
    }

    setSaving(true)
    const { error: insErr } = await supabase
      .from('users')
      .insert({ nome: nomeTrim, pin, ruolo })
    setSaving(false)

    if (insErr) {
      if (insErr.code === '23505') setError('PIN già in uso')
      else setError(insErr.message)
      return
    }
    setNome(''); setPin(''); setRuolo('cameriere')
    onAdded()
  }

  return (
    <form onSubmit={submit} className="card space-y-2">
      <h3 className="font-bold">Aggiungi utente</h3>
      <input
        className="input-base"
        placeholder="Nome (es. Mario)"
        value={nome}
        onChange={e => setNome(e.target.value)}
      />
      <input
        className="input-base"
        placeholder={`PIN (${lenAttesa} cifre)`}
        inputMode="numeric"
        maxLength={lenAttesa}
        value={pin}
        onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, lenAttesa))}
      />
      <label className="block">
        <span className="text-xs opacity-80">Ruolo</span>
        <select
          className="input-base mt-1"
          value={ruolo}
          onChange={e => {
            setRuolo(e.target.value)
            setPin(p => p.slice(0, PIN_LEN(e.target.value)))
          }}
        >
          {RUOLI.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>
      {error && (
        <p className="text-sm bg-red-900/40 border border-red-700 rounded-xl px-2 py-1">
          {error}
        </p>
      )}
      <button type="submit" disabled={saving} className="btn-success w-full">
        {saving ? 'Salvataggio…' : 'Aggiungi'}
      </button>
    </form>
  )
}

// -------------------- TAB IMPOSTAZIONI --------------------

const CHIAVI_TIMER = [
  { chiave: 'tempo_timer_mandate_min',        label: 'Timer tra mandate (min) — evidenzia la mandata successiva in rosso' },
  { chiave: 'tempo_consegna_min',             label: 'Tempo consegna al tavolo (min)' },
  { chiave: 'tempo_preparazione_cucina_min',  label: 'Tempo preparazione cucina (min)' },
  { chiave: 'tempo_consumo_antipasto_min',    label: 'Consumo antipasti (min)' },
  { chiave: 'tempo_consumo_primo_min',        label: 'Consumo primi (min)' },
  { chiave: 'tempo_consumo_secondo_min',      label: 'Consumo secondi (min)' },
  { chiave: 'tempo_consumo_dolce_min',        label: 'Consumo dolci (min)' },
]

const FASCE = [
  { id: 'colazione', label: '🌅 Colazione' },
  { id: 'pranzo',    label: '🌞 Pranzo'    },
  { id: 'aperitivo', label: '🥂 Aperitivo' },
  { id: 'cena',      label: '🌙 Cena'      },
]

function TabImpostazioni() {
  const { fetchImpostazioni, saveImpostazione } = useOrders()
  const [valori, setValori] = useState({})
  const [originali, setOriginali] = useState({})
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const map = await fetchImpostazioni()
      setValori(map); setOriginali(map)
    } catch (e) {
      alert('Errore caricamento impostazioni: ' + (e.message || e))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function showToast(msg, kind = 'success') {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 3500)
  }

  // Salva una lista di chiavi se cambiate, e ricarica.
  async function salvaChiavi(chiavi, etichetta) {
    try {
      let n = 0
      for (const c of chiavi) {
        if (String(valori[c] ?? '') !== String(originali[c] ?? '')) {
          await saveImpostazione(c, valori[c] ?? '')
          n++
        }
      }
      await load()
      showToast(n > 0 ? `✅ ${etichetta} salvate (${n})` : 'Nessuna modifica da salvare')
    } catch (e) {
      alert('Errore salvataggio: ' + (e.message || e))
    }
  }

  return (
    <div className="space-y-6 pb-6">
      {loading ? (
        <p className="text-center opacity-60 py-8">Caricamento…</p>
      ) : (
        <>
          <SezioneFasce
            valori={valori}
            originali={originali}
            setValori={setValori}
            onSalva={() => {
              const chiavi = FASCE.flatMap(f => [
                `fascia_${f.id}_attiva`,
                `fascia_${f.id}_inizio`,
                `fascia_${f.id}_fine`,
              ])
              salvaChiavi(chiavi, 'fasce orarie')
            }}
          />

          <SezioneTimer
            valori={valori}
            setValori={setValori}
            originali={originali}
            onSalva={() => salvaChiavi(CHIAVI_TIMER.map(c => c.chiave), 'impostazioni timer')}
          />

          <SezioneMessaggio
            valore={valori.messaggio_benvenuto ?? ''}
            originale={originali.messaggio_benvenuto ?? ''}
            onChange={v => setValori(s => ({ ...s, messaggio_benvenuto: v }))}
            onSalva={() => salvaChiavi(['messaggio_benvenuto'], 'messaggio benvenuto')}
          />

          <SezioneReset onSuccess={(msg) => { showToast(msg); }} />
        </>
      )}

      {toast && (
        <div className={`fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md
                         rounded-xl px-4 py-3 font-semibold text-center shadow-lg
                         ${toast.kind === 'success' ? 'bg-green-700 text-white' : 'bg-red-700 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ------- Sezione FASCE ORARIE -------

function SezioneFasce({ valori, originali, setValori, onSalva }) {
  const cambiate = FASCE.flatMap(f => [
    `fascia_${f.id}_attiva`,
    `fascia_${f.id}_inizio`,
    `fascia_${f.id}_fine`,
  ]).filter(k => String(valori[k] ?? '') !== String(originali[k] ?? ''))

  return (
    <section className="card border-2 border-cameriere/40">
      <h3 className="font-bold text-lg mb-1">🕐 Fasce orarie servizio</h3>
      <p className="text-xs opacity-70 mb-3">
        Determinano il badge in alto a destra. Se nessuna fascia copre l'ora corrente,
        l'app mostra "⏸️ PAUSA".
      </p>
      <div className="space-y-3">
        {FASCE.map(f => {
          const attivaKey = `fascia_${f.id}_attiva`
          const inizioKey = `fascia_${f.id}_inizio`
          const fineKey   = `fascia_${f.id}_fine`
          const attiva = valori[attivaKey] === 'true'
          return (
            <div key={f.id}
                 className={`rounded-xl border p-3 ${
                   attiva ? 'border-cameriere/40 bg-pannello' : 'border-bordo bg-pannello/30 opacity-60'
                 }`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold">{f.label}</span>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attiva}
                    onChange={e => setValori(s => ({ ...s, [attivaKey]: e.target.checked ? 'true' : 'false' }))}
                  />
                  Attiva
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className="block">
                  <span className="text-xs opacity-80">Inizio</span>
                  <input
                    type="time"
                    value={valori[inizioKey] ?? ''}
                    onChange={e => setValori(s => ({ ...s, [inizioKey]: e.target.value }))}
                    disabled={!attiva}
                    className="input-base mt-1"
                  />
                </label>
                <label className="block">
                  <span className="text-xs opacity-80">Fine</span>
                  <input
                    type="time"
                    value={valori[fineKey] ?? ''}
                    onChange={e => setValori(s => ({ ...s, [fineKey]: e.target.value }))}
                    disabled={!attiva}
                    className="input-base mt-1"
                  />
                </label>
              </div>
            </div>
          )
        })}
      </div>
      <button
        onClick={onSalva}
        disabled={cambiate.length === 0}
        className="btn-success w-full mt-4"
      >
        {cambiate.length === 0 ? 'Nessuna modifica' : `Salva fasce orarie (${cambiate.length})`}
      </button>
    </section>
  )
}

// ------- Sezione TIMER E TEMPI -------

function SezioneTimer({ valori, setValori, originali, onSalva }) {
  const cambiate = CHIAVI_TIMER.filter(
    ({ chiave }) => String(valori[chiave] ?? '') !== String(originali[chiave] ?? '')
  )
  return (
    <section className="card border-2 border-bar/40">
      <h3 className="font-bold text-lg mb-1">⏱️ Timer e tempi</h3>
      <p className="text-xs opacity-70 mb-3">
        Valori in minuti. Il timer tra mandate (riga 1) e' quello principale usato in cucina/bar.
      </p>
      <div className="space-y-2">
        {CHIAVI_TIMER.map(({ chiave, label }) => (
          <label key={chiave} className="block">
            <span className="text-sm opacity-80">{label}</span>
            <input
              type="number" inputMode="numeric" min="0"
              value={valori[chiave] ?? ''}
              onChange={e => setValori(v => ({ ...v, [chiave]: e.target.value }))}
              className="input-base mt-1"
            />
          </label>
        ))}
      </div>
      <button
        onClick={onSalva}
        disabled={cambiate.length === 0}
        className="btn-success w-full mt-4"
      >
        {cambiate.length === 0 ? 'Nessuna modifica' : `Salva timer (${cambiate.length})`}
      </button>
    </section>
  )
}

// ------- Sezione MESSAGGIO BENVENUTO -------

function SezioneMessaggio({ valore, originale, onChange, onSalva }) {
  const cambiato = String(valore ?? '') !== String(originale ?? '')
  return (
    <section className="card border-2 border-emerald-700/40">
      <h3 className="font-bold text-lg mb-1">💬 Messaggio di benvenuto staff</h3>
      <p className="text-xs opacity-70 mb-3">
        Usato dall'invito WhatsApp nella tab Staff. Il link app e il PIN
        vengono aggiunti automaticamente in coda al messaggio.
      </p>
      <textarea
        rows={5}
        value={valore}
        onChange={e => onChange(e.target.value)}
        className="input-base w-full"
        placeholder="Ciao! Sei stato invitato a fare parte dello staff per la nostra sagra. Accedi all'app usando il link e il tuo PIN personale. Buon lavoro! 🎪"
      />
      <button
        onClick={onSalva}
        disabled={!cambiato}
        className="btn-success w-full mt-3"
      >
        {cambiato ? 'Salva messaggio' : 'Nessuna modifica'}
      </button>
    </section>
  )
}

// ------- Sezione RESET E MANUTENZIONE -------

function SezioneReset({ onSuccess }) {
  return (
    <section className="card border-2 border-red-700 bg-red-950/30">
      <h3 className="font-bold text-lg text-red-300 mb-1">⚠️ Reset e manutenzione</h3>
      <p className="text-xs opacity-80 mb-4">
        Usa questi pulsanti per azzerare i dati tra una festa e l'altra.
        <strong> Le operazioni sono irreversibili.</strong>
      </p>

      <div className="space-y-3">
        <BottoneReset
          etichetta="🗑️ Azzera tutti gli ordini"
          descrizione="Elimina ordini e voci. Menu e staff restano."
          confermaTesto="CONFERMO"
          esegui={async () => {
            const { error: e1 } = await supabase
              .from('order_items').delete()
              .neq('id', '00000000-0000-0000-0000-000000000000')
            if (e1) throw e1
            const { error: e2 } = await supabase
              .from('orders').delete()
              .neq('id', '00000000-0000-0000-0000-000000000000')
            if (e2) throw e2
          }}
          onDone={() => onSuccess('✅ Tutti gli ordini eliminati')}
        />

        <BottoneReset
          etichetta="🗑️ Azzera menu cucina"
          descrizione="Elimina tutte le voci di menu con categoria=cucina."
          confermaTesto="CONFERMO"
          esegui={async () => {
            const { error } = await supabase
              .from('menu_items').delete().eq('categoria', 'cucina')
            if (error) throw error
          }}
          onDone={() => onSuccess('✅ Menu cucina eliminato')}
        />

        <BottoneReset
          etichetta="🗑️ Azzera menu bar"
          descrizione="Elimina tutte le voci di menu con categoria=bar."
          confermaTesto="CONFERMO"
          esegui={async () => {
            const { error } = await supabase
              .from('menu_items').delete().eq('categoria', 'bar')
            if (error) throw error
          }}
          onDone={() => onSuccess('✅ Menu bar eliminato')}
        />

        <BottoneReset
          etichetta="🗑️ Reset completo"
          descrizione="Elimina ordini, voci e menu. Mantiene staff e impostazioni."
          confermaTesto="RESET COMPLETO"
          esegui={async () => {
            const { error: e1 } = await supabase
              .from('order_items').delete()
              .neq('id', '00000000-0000-0000-0000-000000000000')
            if (e1) throw e1
            const { error: e2 } = await supabase
              .from('orders').delete()
              .neq('id', '00000000-0000-0000-0000-000000000000')
            if (e2) throw e2
            const { error: e3 } = await supabase
              .from('menu_items').delete()
              .neq('id', '00000000-0000-0000-0000-000000000000')
            if (e3) throw e3
          }}
          onDone={() => onSuccess('✅ Reset completo eseguito — app pronta per nuova festa')}
        />
      </div>
    </section>
  )
}

// Pulsante reset con flusso a step:
//   0 = pulsante iniziale (ETICHETTA, click -> step 1)
//   1 = dialog conferma (window.confirm) -> step 2 oppure 0
//   2 = input "CONFERMO" -> bottone esegui sbloccato
function BottoneReset({ etichetta, descrizione, confermaTesto, esegui, onDone }) {
  const [step, setStep] = useState(0)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const startConferma = () => {
    const ok = window.confirm(
      `${etichetta}\n\nSei sicuro? L'operazione e' irreversibile.\n\nPremi OK per passare alla conferma finale.`
    )
    if (ok) setStep(2)
  }

  const eseguiNow = async () => {
    if (input.trim().toUpperCase() !== confermaTesto.toUpperCase()) return
    setBusy(true)
    try {
      await esegui()
      onDone()
      setStep(0); setInput('')
    } catch (e) {
      alert('Errore: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-red-700 bg-red-950/30 p-3">
      <p className="font-bold text-red-200 text-sm">{etichetta}</p>
      <p className="text-xs opacity-80 mb-2">{descrizione}</p>

      {step === 0 && (
        <button
          onClick={startConferma}
          className="w-full rounded-xl bg-red-700 text-white font-bold py-2 active:scale-95"
        >
          Avvia
        </button>
      )}

      {step === 2 && (
        <div className="space-y-2">
          <p className="text-xs">
            Per confermare, scrivi <strong className="font-mono">{confermaTesto}</strong> qui sotto:
          </p>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={confermaTesto}
            className="input-base"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setStep(0); setInput('') }}
              disabled={busy}
              className="btn-neutral"
            >
              Annulla
            </button>
            <button
              onClick={eseguiNow}
              disabled={busy || input.trim().toUpperCase() !== confermaTesto.toUpperCase()}
              className="rounded-xl bg-red-700 text-white font-bold py-2 disabled:opacity-40 active:scale-95"
            >
              {busy ? 'In corso…' : 'Esegui ora'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
