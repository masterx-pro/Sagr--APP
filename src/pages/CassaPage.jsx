import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import { useExitConfirmGuard } from '../hooks/useExitConfirmGuard.js'
import { useImpostazioni } from '../context/ImpostazioniContext.jsx'
import TableBadge from '../components/TableBadge.jsx'
import ServizioBadge from '../components/ServizioBadge.jsx'

/**
 * CassaPage: ruolo cassa.
 * Vede tutti gli ordini in 'attesa_cassa' o 'stornato' (contanti da
 * incassare o ri-conferma post-storno). Filtra per tavolo / nome.
 * Marca "Incassato" -> ordine torna 'confermato' (riparte cucina/bar).
 */
export default function CassaPage({ user, onLogout }) {
  useExitConfirmGuard(onLogout)

  const { orders, fetchCassaQueue, confermaPagamentoCassa } = useOrders()
  const { impostazioni } = useImpostazioni()
  const [view, setView] = useState('list') // 'list' | 'detail'
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => { fetchCassaQueue() }, [fetchCassaQueue])

  useEffect(() => {
    // La cassa vede tutti gli ordini in attesa/storno (cross-servizio):
    // ascoltiamo '*' su orders (serve INSERT per nuovi ingressi + UPDATE storni).
    // order_items non serve: il totale cambia via UPDATE su orders;
    // il dettaglio ha il suo channel mirato.
    const channel = supabase
      .channel('cassa-feed')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => fetchCassaQueue())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchCassaQueue])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(o => {
      const tav = String(o.numero_tavolo || '')
      const nome = (o.nome_cliente || '').toLowerCase()
      return tav.includes(q) || nome.includes(q)
    })
  }, [orders, search])

  // Protezione tasto indietro dal dettaglio
  useEffect(() => {
    if (view !== 'detail') return
    window.history.pushState(null, '', window.location.href)
    const onPop = () => { setView('list'); setSelectedId(null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [view])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-cassa px-4 py-3 flex items-center justify-between
                         sticky top-0 z-30 mobile-landscape:py-2">
        <div className="flex items-center gap-2 min-w-0">
          {view === 'detail' && (
            <button
              onClick={() => { setView('list'); setSelectedId(null) }}
              className="px-3 py-1 rounded-lg bg-white/20 text-sm font-semibold"
            >
              ← Indietro
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-bold text-lg mobile-landscape:text-base">Cassa</h1>
            <p className="text-xs opacity-90 truncate mobile-landscape:hidden">
              {user.nome}
            </p>
          </div>
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

      <main className="flex-1 p-4 mobile-landscape:p-3">
        {view === 'list' && (
          <ListaCassa
            orders={filtered}
            totaleQueue={orders.length}
            search={search}
            onSearch={setSearch}
            onSelect={(id) => { setSelectedId(id); setView('detail') }}
          />
        )}
        {view === 'detail' && selectedId && (
          <DettaglioCassa
            orderId={selectedId}
            onIncassato={async (tipoPagamento) => {
              try {
                await confermaPagamentoCassa(selectedId, tipoPagamento)
                await fetchCassaQueue()
                setView('list')
                setSelectedId(null)
              } catch (e) {
                alert('Errore: ' + (e.message || e))
              }
            }}
          />
        )}
      </main>
    </div>
  )
}

// -------------------- LISTA --------------------

function ListaCassa({ orders, totaleQueue, search, onSearch, onSelect }) {
  if (totaleQueue === 0) {
    return (
      <p className="text-center text-2xl opacity-60 py-16
                    mobile-landscape:py-6 mobile-landscape:text-xl">
        Nessun ordine da incassare 💚
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        inputMode="search"
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder="Cerca per numero tavolo o nome…"
        className="input-base"
      />
      {orders.length === 0 ? (
        <p className="text-center opacity-60 py-8">
          Nessun ordine corrisponde a "{search}"
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                       mobile-landscape:grid-cols-2 gap-3">
          {orders.map(o => (
            <CassaCard key={o.id} order={o} onClick={() => onSelect(o.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CassaCard({ order, onClick }) {
  const stornato = order.stato === 'stornato'
  const minuti = Math.max(0, Math.floor((Date.now() - new Date(order.created_at)) / 60000))
  const ora = new Date(order.created_at)
    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

  return (
    <li
      onClick={onClick}
      className={`card cursor-pointer active:scale-[0.98] transition-transform
                  border-l-4 ${stornato
                    ? 'border-l-red-500 bg-red-900/15'
                    : 'border-l-amber-500 bg-amber-900/10'}`}
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="md" />
        {order.nome_cliente && (
          <span className="text-sm font-semibold">· {order.nome_cliente}</span>
        )}
        {stornato && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-700 text-white
                           uppercase tracking-wide">
            ⚠️ Stornato
          </span>
        )}
      </div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="opacity-80">💵 Contanti</span>
        <span className="text-xl font-bold text-green-400">
          € {Number(order.totale).toFixed(2)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs opacity-70">
        <span>{ora} · ⏱ {minuti} min</span>
        {order.cameriere_nome && <span>👤 {order.cameriere_nome}</span>}
      </div>
      {stornato && order.storno_note && (
        <p className="text-xs mt-2 bg-red-900/30 border border-red-700 rounded-lg p-2 break-words">
          Storno: {order.storno_note}
        </p>
      )}
    </li>
  )
}

// -------------------- DETTAGLIO --------------------

function DettaglioCassa({ orderId, onIncassato }) {
  const [order, setOrder] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single()
    setOrder(data)
  }, [orderId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel(`cassa-detail-${orderId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${orderId}` },
        () => load())
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [orderId, load])

  if (!order) return <p className="text-center opacity-60 py-10">Caricamento…</p>

  const stornato = order.stato === 'stornato'
  const items = order.order_items || []
  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')

  const incassa = async (tipoPagamento) => {
    const metodoLabel = tipoPagamento === 'bancomat' ? 'BANCOMAT' : 'CONTANTI'
    const conferma = window.confirm(
      `Confermi l'incasso (${metodoLabel}) di € ${Number(order.totale).toFixed(2)} per Tav. ${order.numero_tavolo}${order.nome_cliente ? ' · ' + order.nome_cliente : ''}?`
    )
    if (!conferma) return
    setBusy(true)
    try {
      await onIncassato(tipoPagamento)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg" />
          {order.nome_cliente && (
            <span className="text-xl font-bold">· {order.nome_cliente}</span>
          )}
        </div>
        <span className="text-2xl font-bold text-green-400">
          € {Number(order.totale).toFixed(2)}
        </span>
      </div>

      {stornato && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl p-3">
          <p className="font-bold text-red-300 mb-1">⚠️ ORDINE STORNATO</p>
          {order.storno_note && (
            <p className="text-sm break-words">Motivo: {order.storno_note}</p>
          )}
          <p className="text-xs opacity-80 mt-1">
            Incassando, l'ordine torna in cucina/bar dove era stato messo in pausa.
          </p>
        </div>
      )}

      {order.note && (
        <p className="text-sm bg-yellow-900/40 border border-yellow-700 rounded-xl p-2">
          Note: {order.note}
        </p>
      )}

      <Sezione titolo="Cucina" items={cucinaItems} colore="text-cucina" />
      <Sezione titolo="Bar"    items={barItems}    colore="text-bar" />

      {stornato ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            disabled={busy}
            onClick={() => incassa('bancomat')}
            className="card bg-blue-900/40 border-2 border-blue-700 hover:bg-blue-900/60
                       min-h-[5rem] flex flex-col items-center justify-center text-lg font-bold"
          >
            💳 Ri-conferma Bancomat
          </button>
          <button
            disabled={busy}
            onClick={() => incassa('contanti')}
            className="card bg-emerald-900/40 border-2 border-emerald-700 hover:bg-emerald-900/60
                       min-h-[5rem] flex flex-col items-center justify-center text-lg font-bold"
          >
            💵 Ri-conferma Contanti
          </button>
        </div>
      ) : (
        <button
          disabled={busy}
          onClick={() => incassa('contanti')}
          className="btn-success w-full text-xl py-4"
        >
          {busy ? 'In corso…' : '✅ Incassato'}
        </button>
      )}
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
          <li key={it.id} className="flex items-start justify-between gap-3 card py-2">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              <span className="text-[10px] px-2 py-0.5 rounded-full
                               bg-cameriere/40 border border-cameriere uppercase tracking-wide">
                M{it.mandata}
              </span>
              <span className="font-semibold break-words whitespace-normal">
                {it.nome_item}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm shrink-0">
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
