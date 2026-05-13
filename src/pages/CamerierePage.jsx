import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import MenuSelector from '../components/MenuSelector.jsx'
import OrderCard from '../components/OrderCard.jsx'
import TableBadge from '../components/TableBadge.jsx'

/**
 * CamerierePage: tre viste (lista, nuovo, dettaglio).
 */
export default function CamerierePage({ user, onLogout }) {
  const [view, setView] = useState('list') // list | new | detail
  const [selectedId, setSelectedId] = useState(null)
  const [menu, setMenu] = useState([])
  const [menuLoading, setMenuLoading] = useState(false)

  const {
    orders, fetchOpenOrders,
    createOrder, addItemsToOrder,
    markOrderPaid
  } = useOrders({ autoload: true })

  // Carica menu fresco da Supabase (no cache)
  const loadMenu = useCallback(async () => {
    setMenuLoading(true)
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('attivo', true)
      .order('ordine')
    setMenu(data || [])
    setMenuLoading(false)
  }, [])

  useEffect(() => { loadMenu() }, [loadMenu])

  // Ricarica il menu ogni volta che si entra nella vista "Nuovo Tavolo"
  useEffect(() => {
    if (view === 'new') loadMenu()
  }, [view, loadMenu])

  // Realtime: aggiorna la lista al cambiamento di order_items/orders
  useEffect(() => {
    const channel = supabase
      .channel('cameriere-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' },
        () => fetchOpenOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },
        () => fetchOpenOrders())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchOpenOrders])

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        color="bg-cameriere"
        nome={user.nome}
        ruolo="Cameriere"
        onLogout={onLogout}
        leftAction={view !== 'list' && (
          <button
            onClick={() => { setView('list'); setSelectedId(null) }}
            className="px-3 py-1 rounded-lg bg-white/20 text-sm font-semibold"
          >
            ← Indietro
          </button>
        )}
      />

      <main className="flex-1 p-4">
        {view === 'list' && (
          <ListaTavoli
            orders={orders}
            onNew={() => setView('new')}
            onSelect={(id) => { setSelectedId(id); setView('detail') }}
          />
        )}
        {view === 'new' && (
          <NuovoOrdine
            menu={menu}
            onRefresh={loadMenu}
            refreshing={menuLoading}
            onCreate={async (tavolo, persone, items, note) => {
              await createOrder(tavolo, persone, items, note)
              await fetchOpenOrders()
              setView('list')
            }}
          />
        )}
        {view === 'detail' && selectedId && (
          <DettaglioOrdine
            orderId={selectedId}
            menu={menu}
            onAddItems={async (items) => {
              await addItemsToOrder(selectedId, items)
              await fetchOpenOrders()
            }}
            onPaid={async () => {
              await markOrderPaid(selectedId)
              await fetchOpenOrders()
              setView('list')
              setSelectedId(null)
            }}
          />
        )}
      </main>
    </div>
  )
}

// -------------------- Header --------------------

function Header({ color, nome, ruolo, onLogout, leftAction }) {
  return (
    <header className={`${color} px-4 py-3 flex items-center justify-between gap-2`}>
      <div className="flex items-center gap-2 min-w-0">
        {leftAction}
        <div className="min-w-0">
          <p className="font-bold truncate">{nome}</p>
          <p className="text-xs opacity-90">{ruolo}</p>
        </div>
      </div>
      <button
        onClick={onLogout}
        className="px-3 py-2 rounded-lg bg-white/20 text-sm font-semibold"
      >
        Esci
      </button>
    </header>
  )
}

// -------------------- Vista 1: Lista Tavoli --------------------

function ListaTavoli({ orders, onNew, onSelect }) {
  return (
    <div className="space-y-3">
      <button onClick={onNew} className="btn-primary w-full text-lg">
        + Nuovo Tavolo
      </button>

      {orders.length === 0 && (
        <p className="text-center opacity-60 py-8">Nessun tavolo aperto</p>
      )}

      {orders.map(o => (
        <OrderCard
          key={o.id}
          order={o}
          items={o.order_items || []}
          onClick={() => onSelect(o.id)}
        />
      ))}
    </div>
  )
}

// -------------------- Vista 2: Nuovo Ordine --------------------

function NuovoOrdine({ menu, onCreate, onRefresh, refreshing }) {
  const [tavolo, setTavolo] = useState('')
  const [persone, setPersone] = useState('1')
  const [note, setNote] = useState('')
  const [qty, setQty] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const itemsArr = useMemo(() => {
    return Object.entries(qty)
      .map(([id, quantita]) => {
        const menuItem = menu.find(m => m.id === id)
        return menuItem ? { menuItem, quantita } : null
      })
      .filter(Boolean)
  }, [qty, menu])

  const totale = itemsArr.reduce(
    (s, it) => s + Number(it.menuItem.prezzo) * it.quantita, 0
  )

  const canSubmit = tavolo && Number(tavolo) > 0 && itemsArr.length > 0 && !submitting

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onCreate(
        parseInt(tavolo, 10),
        Math.max(1, parseInt(persone, 10) || 1),
        itemsArr,
        note || null
      )
    } catch (e) {
      alert('Errore creazione ordine: ' + (e.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pb-32">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm opacity-70">Nuovo ordine</span>
        <button
          type="button"
          onClick={onRefresh}
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

      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="text-sm opacity-80">N. Tavolo</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            value={tavolo}
            onChange={e => setTavolo(e.target.value)}
            className="input-base mt-1"
            placeholder="es. 12"
          />
        </label>
        <label className="block">
          <span className="text-sm opacity-80">N. Persone</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            value={persone}
            onChange={e => setPersone(e.target.value)}
            className="input-base mt-1"
          />
        </label>
      </div>
      <label className="block mb-3">
        <span className="text-sm opacity-80">Note (opzionali)</span>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          className="input-base mt-1"
          placeholder="Allergie, richieste..."
        />
      </label>

      <MenuSelector items={menu} quantities={qty} onChange={setQty} />

      <div className="fixed bottom-0 left-0 right-0 bg-pannello border-t border-bordo p-3 z-20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm opacity-80">
            {itemsArr.reduce((s, it) => s + it.quantita, 0)} pezzi
          </span>
          <span className="text-xl font-bold">€ {totale.toFixed(2)}</span>
        </div>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="btn-success w-full text-lg"
        >
          {submitting ? 'Invio…' : 'Invia Ordine'}
        </button>
      </div>
    </div>
  )
}

// -------------------- Vista 3: Dettaglio Ordine --------------------

function DettaglioOrdine({ orderId, menu, onAddItems, onPaid }) {
  const [order, setOrder] = useState(null)
  const [adding, setAdding] = useState(false)
  const [qty, setQty] = useState({})
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single()
    setOrder(data)
  }

  useEffect(() => { load() }, [orderId])

  useEffect(() => {
    const channel = supabase
      .channel(`dettaglio-${orderId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${orderId}` },
        () => load())
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [orderId])

  if (!order) {
    return <p className="text-center opacity-60 py-10">Caricamento…</p>
  }

  const items = order.order_items || []
  const tuttoPronto = items.length > 0 && items.every(i => i.pronto)

  if (adding) {
    const itemsArr = Object.entries(qty)
      .map(([id, quantita]) => {
        const m = menu.find(mm => mm.id === id)
        return m ? { menuItem: m, quantita } : null
      })
      .filter(Boolean)
    const totaleAgg = itemsArr.reduce(
      (s, it) => s + Number(it.menuItem.prezzo) * it.quantita, 0
    )

    return (
      <div className="pb-32">
        <p className="mb-3 font-semibold">Aggiungi al tavolo {order.numero_tavolo}</p>
        <MenuSelector items={menu} quantities={qty} onChange={setQty} />
        <div className="fixed bottom-0 left-0 right-0 bg-pannello border-t border-bordo p-3 z-20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm opacity-80">
              {itemsArr.reduce((s, it) => s + it.quantita, 0)} pezzi
            </span>
            <span className="text-xl font-bold">+ € {totaleAgg.toFixed(2)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setAdding(false); setQty({}) }}
              className="btn-neutral flex-1"
            >
              Annulla
            </button>
            <button
              disabled={itemsArr.length === 0 || busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onAddItems(itemsArr)
                  setQty({})
                  setAdding(false)
                  await load()
                } catch (e) {
                  alert('Errore: ' + (e.message || e))
                } finally {
                  setBusy(false)
                }
              }}
              className="btn-success flex-1"
            >
              Aggiungi
            </button>
          </div>
        </div>
      </div>
    )
  }

  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between">
        <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg" />
        <span className="text-2xl font-bold">€ {Number(order.totale).toFixed(2)}</span>
      </div>

      {order.note && (
        <p className="text-sm bg-yellow-900/40 border border-yellow-700 rounded-xl p-2">
          Note: {order.note}
        </p>
      )}

      <Sezione titolo="Cucina" items={cucinaItems} colore="text-cucina" />
      <Sezione titolo="Bar"    items={barItems}    colore="text-bar" />

      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={order.stato === 'pagato'}
          onClick={() => setAdding(true)}
          className="btn-neutral"
        >
          + Aggiungi item
        </button>
        <button
          disabled={!tuttoPronto || order.stato === 'pagato' || busy}
          onClick={async () => {
            setBusy(true)
            try { await onPaid() } finally { setBusy(false) }
          }}
          className="btn-success"
        >
          {order.stato === 'pagato' ? 'Pagato' : 'Segna come Pagato'}
        </button>
      </div>
    </div>
  )
}

function Sezione({ titolo, items, colore }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className={`font-bold mb-2 ${colore}`}>{titolo}</h3>
      <ul className="space-y-1">
        {items.map(it => (
          <li
            key={it.id}
            className="flex items-center justify-between card py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`badge ${it.pronto ? 'bg-green-700' : 'bg-yellow-600'}`}>
                {it.pronto ? 'Pronto' : 'In attesa'}
              </span>
              <span className="font-semibold truncate">
                {it.nome_item}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="opacity-80">× {it.quantita}</span>
              <span className="font-bold">
                € {(Number(it.prezzo_unitario) * it.quantita).toFixed(2)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
