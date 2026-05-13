import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import OrderCard from '../components/OrderCard.jsx'

/**
 * AdminPage: 3 tab → Ordini, Menu, Riepilogo.
 */
export default function AdminPage({ user, onLogout }) {
  const [tab, setTab] = useState('ordini')

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-admin px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg">Admin</h1>
          <p className="text-xs opacity-90">{user.nome}</p>
        </div>
        <button
          onClick={onLogout}
          className="px-3 py-2 rounded-lg bg-white/20 text-sm font-semibold"
        >
          Esci
        </button>
      </header>

      <nav className="grid grid-cols-3 gap-1 p-2 bg-pannello border-b border-bordo">
        <TabBtn active={tab === 'ordini'}    onClick={() => setTab('ordini')}>Ordini</TabBtn>
        <TabBtn active={tab === 'menu'}      onClick={() => setTab('menu')}>Menu</TabBtn>
        <TabBtn active={tab === 'riepilogo'} onClick={() => setTab('riepilogo')}>Riepilogo</TabBtn>
      </nav>

      <main className="flex-1 p-4">
        {tab === 'ordini'    && <TabOrdini />}
        {tab === 'menu'      && <TabMenu />}
        {tab === 'riepilogo' && <TabRiepilogo />}
      </main>
    </div>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-btn rounded-xl font-semibold ${
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

  useEffect(() => {
    fetchAllOrders()
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },
        () => fetchAllOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' },
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

  if (orders.length === 0) {
    return <p className="text-center opacity-60 py-8">Nessun ordine</p>
  }

  return (
    <div className="space-y-3">
      {orders.map(o => (
        <OrderCard
          key={o.id}
          order={o}
          items={o.order_items || []}
          onDelete={handleDelete}
        />
      ))}
    </div>
  )
}

// -------------------- TAB MENU --------------------

function TabMenu() {
  const [items, setItems] = useState([])
  const [nome, setNome] = useState('')
  const [prezzo, setPrezzo] = useState('')
  const [categoria, setCategoria] = useState('cucina')
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

  const aggiungi = async (e) => {
    e.preventDefault()
    const p = parseFloat(prezzo.replace(',', '.'))
    if (!nome.trim() || isNaN(p) || p < 0) {
      alert('Compila nome e prezzo validi')
      return
    }
    const { error } = await supabase.from('menu_items').insert({
      nome: nome.trim(),
      prezzo: p,
      categoria,
      ordine: 99
    })
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
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className={`font-semibold truncate ${i.attivo ? '' : 'line-through opacity-50'}`}>
              {i.nome}
            </p>
            <p className="text-sm opacity-80">€ {Number(i.prezzo).toFixed(2)}</p>
          </div>
          <button
            onClick={() => onEdit(i.id)}
            className="px-3 py-2 rounded-xl text-sm font-semibold bg-pannello border border-bordo"
          >
            Modifica
          </button>
          <button
            onClick={() => onToggle(i)}
            className={`px-3 py-2 rounded-xl text-sm font-semibold ${
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
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const p = parseFloat(String(prezzo).replace(',', '.'))
    if (!nome.trim() || isNaN(p) || p < 0) {
      alert('Compila nome e prezzo validi')
      return
    }
    setSaving(true)
    try {
      await onSave(item.id, {
        nome: nome.trim(),
        prezzo: p,
        categoria
      })
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
      .select('id, numero_tavolo, stato, totale, order_items(nome_item, quantita)')

    if (!tutti) return

    const pagati = tutti.filter(o => o.stato === 'pagato')
    const aperti = tutti.filter(o => o.stato !== 'pagato')
    const incasso = pagati.reduce((s, o) => s + Number(o.totale), 0)
    const tavoliServiti = new Set(pagati.map(o => o.numero_tavolo)).size

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
      incasso,
      tavoliServiti,
      ordiniAperti: aperti.length,
      top5
    })
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('admin-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  if (!stats) {
    return <p className="text-center opacity-60 py-8">Caricamento…</p>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Incasso serata" value={`€ ${stats.incasso.toFixed(2)}`} />
        <StatCard label="Tavoli serviti" value={stats.tavoliServiti} />
        <StatCard label="Ordini aperti" value={stats.ordiniAperti} />
      </div>

      <div>
        <h3 className="font-bold mb-2">Top 5 prodotti</h3>
        {stats.top5.length === 0 ? (
          <p className="opacity-60 text-sm">Nessun dato</p>
        ) : (
          <ol className="space-y-2">
            {stats.top5.map(([nome, q], i) => (
              <li key={nome} className="card flex items-center justify-between">
                <span className="font-semibold">
                  {i + 1}. {nome}
                </span>
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
