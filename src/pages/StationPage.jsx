import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import TableBadge from '../components/TableBadge.jsx'

/**
 * StationPage: vista comune per Bar e Cucina.
 * - Filtra order_items per categoria, raggruppa per tavolo.
 * - Pulsante "Tutto Pronto" su ogni card marca i pendenti come pronti.
 * - Aggiornamenti via Supabase Realtime.
 */
export default function StationPage({ user, onLogout, categoria, titolo, coloreHeader }) {
  const [pending, setPending] = useState([]) // [{order, items[]}]
  const { markTableCategoryReady } = useOrders()
  const [refreshTick, setRefreshTick] = useState(0)

  const load = async () => {
    // Prendiamo ordini non pagati con i loro items + ordine della portata da menu_items
    const { data, error } = await supabase
      .from('orders')
      .select('id, numero_tavolo, n_persone, created_at, note, order_items(*, menu_items(ordine))')
      .neq('stato', 'pagato')
      .order('created_at', { ascending: true })
    if (error) {
      console.error(error)
      return
    }
    const grouped = (data || [])
      .map(o => ({
        order: o,
        items: (o.order_items || []).filter(i => i.categoria === categoria && !i.pronto)
      }))
      .filter(g => g.items.length > 0)
    setPending(grouped)
  }

  useEffect(() => { load() }, [refreshTick, categoria])

  useEffect(() => {
    const channel = supabase
      .channel(`station-${categoria}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => setRefreshTick(t => t + 1))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => setRefreshTick(t => t + 1))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [categoria])

  return (
    <div className="min-h-screen flex flex-col">
      <header className={`${coloreHeader} px-4 py-3 flex items-center justify-between
                          sticky top-0 z-20 mobile-landscape:py-2`}>
        <div className="min-w-0">
          <h1 className="font-bold text-lg mobile-landscape:text-base">{titolo}</h1>
          <p className="text-xs opacity-90 truncate">{user.nome}</p>
        </div>
        <button
          onClick={onLogout}
          className="px-3 py-2 rounded-lg bg-white/20 text-sm font-semibold"
        >
          Esci
        </button>
      </header>

      <main className="flex-1 p-4 mobile-landscape:p-3">
        {pending.length === 0 ? (
          <p className="text-center text-2xl opacity-60 py-16
                        mobile-landscape:py-6 mobile-landscape:text-xl">
            Tutto pronto 🎉
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                         mobile-landscape:grid-cols-2 gap-3">
            {pending.map(({ order, items }) => (
              <StationCard
                key={order.id}
                order={order}
                items={items}
                categoria={categoria}
                onReady={async () => {
                  try {
                    await markTableCategoryReady(order.id, categoria)
                    setRefreshTick(t => t + 1)
                  } catch (e) {
                    alert('Errore: ' + (e.message || e))
                  }
                }}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

const PORTATE_CUCINA = [
  { label: 'Antipasti', test: o => o >= 1  && o <= 9  },
  { label: 'Primi',     test: o => o >= 10 && o <= 19 },
  { label: 'Secondi',   test: o => o >= 20 && o <= 29 },
  { label: 'Dolci',     test: o => o >= 30 && o <= 39 },
]

function groupByPortataCucina(items) {
  const groups = PORTATE_CUCINA.map(p => ({
    label: p.label,
    items: items.filter(i => p.test(i.ordine ?? 0)),
  }))
  const altro = items.filter(i => !PORTATE_CUCINA.some(p => p.test(i.ordine ?? 0)))
  if (altro.length) groups.push({ label: 'Altro', items: altro })
  return groups.filter(g => g.items.length > 0)
}

function StationCard({ order, items, categoria, onReady }) {
  const [busy, setBusy] = useState(false)

  // Aggrega le quantità per nome, mantenendo l'ordine di portata da menu_items
  const aggr = useMemo(() => {
    const map = new Map() // nome → { nome, ordine, q }
    for (const it of items) {
      const ordine = it.menu_items?.ordine ?? 99
      const cur = map.get(it.nome_item) || { nome: it.nome_item, ordine, q: 0 }
      cur.q += it.quantita
      map.set(it.nome_item, cur)
    }
    return Array.from(map.values())
  }, [items])

  const renderRiga = ({ nome, q }) => (
    <li key={nome} className="flex items-start justify-between gap-3 text-xl">
      <span className="font-semibold flex-1 min-w-0 break-words whitespace-normal">
        {nome}
      </span>
      <span className="font-bold text-2xl shrink-0">× {q}</span>
    </li>
  )

  return (
    <li className="card">
      <div className="flex items-center justify-between mb-3">
        <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg" />
        <span className="text-sm opacity-80">
          {new Date(order.created_at).toLocaleTimeString('it-IT', {
            hour: '2-digit', minute: '2-digit'
          })}
        </span>
      </div>

      {order.note && (
        <p className="text-sm bg-yellow-900/40 border border-yellow-700 rounded-xl p-2 mb-2">
          Note: {order.note}
        </p>
      )}

      <ul className="space-y-1 mb-3">
        {categoria === 'cucina'
          ? groupByPortataCucina(aggr).flatMap(g => [
              <li
                key={`hdr-${g.label}`}
                className="flex items-center gap-2 text-xs font-bold uppercase
                           tracking-widest text-cucina mt-2 first:mt-0 select-none"
              >
                <span className="flex-1 h-px bg-cucina/40" aria-hidden="true" />
                <span>— {g.label} —</span>
                <span className="flex-1 h-px bg-cucina/40" aria-hidden="true" />
              </li>,
              ...g.items.map(renderRiga),
            ])
          : aggr.map(renderRiga)}
      </ul>

      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try { await onReady() } finally { setBusy(false) }
        }}
        className="btn-success w-full text-lg"
      >
        {busy ? 'Aggiornamento…' : 'Tutto Pronto'}
      </button>
    </li>
  )
}
