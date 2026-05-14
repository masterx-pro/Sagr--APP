import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import TableBadge from '../components/TableBadge.jsx'

/**
 * StationPage: vista comune per Bar e Cucina con due tab:
 *   📋 Per Tavolo  → ordini raggruppati per tavolo (vista classica)
 *   📊 Aggregato   → ordini raggruppati per pietanza
 */
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

export default function StationPage({ user, onLogout, categoria, titolo, coloreHeader }) {
  const [pending, setPending] = useState([]) // [{order, items[]}]
  const [view, setView] = useState('per-tavolo') // 'per-tavolo' | 'aggregato'
  const { markTableCategoryReady, markPietanzaReady } = useOrders()
  const [refreshTick, setRefreshTick] = useState(0)

  const load = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, numero_tavolo, n_persone, created_at, note, order_items(*, menu_items(ordine))')
      .neq('stato', 'pagato_archiviato') // tieni tutti tranne eventuali archiviati futuri
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

      <nav className="grid grid-cols-2 gap-1 p-2 bg-pannello border-b border-bordo
                      sticky top-[3.25rem] z-10 mobile-landscape:top-[2.5rem]
                      mobile-landscape:p-1">
        <TabBtn
          active={view === 'per-tavolo'}
          coloreHeader={coloreHeader}
          onClick={() => setView('per-tavolo')}
        >
          📋 Per Tavolo
        </TabBtn>
        <TabBtn
          active={view === 'aggregato'}
          coloreHeader={coloreHeader}
          onClick={() => setView('aggregato')}
        >
          📊 Aggregato
        </TabBtn>
      </nav>

      <main className="flex-1 p-4 mobile-landscape:p-3">
        {pending.length === 0 ? (
          <p className="text-center text-2xl opacity-60 py-16
                        mobile-landscape:py-6 mobile-landscape:text-xl">
            Tutto pronto 🎉
          </p>
        ) : view === 'per-tavolo' ? (
          <VistaPerTavolo
            pending={pending}
            categoria={categoria}
            onTuttoPronto={async (orderId) => {
              try {
                await markTableCategoryReady(orderId, categoria)
                setRefreshTick(t => t + 1)
              } catch (e) {
                alert('Errore: ' + (e.message || e))
              }
            }}
          />
        ) : (
          <VistaAggregata
            pending={pending}
            categoria={categoria}
            onPietanzaReady={async (nomeItem) => {
              try {
                await markPietanzaReady(categoria, nomeItem)
                setRefreshTick(t => t + 1)
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

function TabBtn({ active, onClick, coloreHeader, children }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-btn rounded-xl font-semibold text-sm sm:text-base
                  mobile-landscape:min-h-[36px] mobile-landscape:rounded-lg
                  mobile-landscape:text-xs ${
        active ? `${coloreHeader} text-white` : 'bg-sfondo border border-bordo'
      }`}
    >
      {children}
    </button>
  )
}

// -------------------- VISTA PER TAVOLO --------------------

function VistaPerTavolo({ pending, categoria, onTuttoPronto }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                   mobile-landscape:grid-cols-2 gap-3">
      {pending.map(({ order, items }) => (
        <StationCard
          key={order.id}
          order={order}
          items={items}
          categoria={categoria}
          onReady={() => onTuttoPronto(order.id)}
        />
      ))}
    </ul>
  )
}

function StationCard({ order, items, categoria, onReady }) {
  const [busy, setBusy] = useState(false)

  const aggr = useMemo(() => {
    const map = new Map()
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
          ? groupByPortata(aggr, PORTATE_CUCINA).flatMap(g => [
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

// -------------------- VISTA AGGREGATA --------------------

function VistaAggregata({ pending, categoria, onPietanzaReady }) {
  // Aggrega per nome_item: { nome_item, ordine, total_qty, byTavolo: [{tavolo, qty}] }
  const aggregated = useMemo(() => {
    const map = new Map()
    for (const { order, items } of pending) {
      for (const it of items) {
        const key = it.nome_item
        if (!map.has(key)) {
          map.set(key, {
            nome_item: it.nome_item,
            ordine: it.menu_items?.ordine ?? 99,
            byTavolo: new Map(),
          })
        }
        const entry = map.get(key)
        const cur = entry.byTavolo.get(order.numero_tavolo) || 0
        entry.byTavolo.set(order.numero_tavolo, cur + it.quantita)
      }
    }
    return Array.from(map.values()).map(e => ({
      nome_item: e.nome_item,
      ordine: e.ordine,
      total_qty: Array.from(e.byTavolo.values()).reduce((s, q) => s + q, 0),
      byTavolo: Array.from(e.byTavolo.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([tavolo, qty]) => ({ tavolo, qty })),
    }))
  }, [pending])

  const groups = useMemo(() => {
    const schema = categoria === 'cucina' ? PORTATE_CUCINA : PORTATE_BAR
    return groupByPortata(aggregated, schema)
  }, [aggregated, categoria])

  // Mappo le proprietà di colore in base alla categoria
  const tema = categoria === 'cucina'
    ? { sepText: 'text-cucina', sepLine: 'bg-cucina/40', badgeBg: 'bg-cucina' }
    : { sepText: 'text-bar',    sepLine: 'bg-bar/40',    badgeBg: 'bg-bar'    }

  return (
    <div className="space-y-6">
      {groups.map(g => (
        <section key={g.label}>
          <h2 className={`flex items-center gap-2 mb-3 text-xs font-bold uppercase
                          tracking-widest ${tema.sepText} select-none`}>
            <span className={`flex-1 h-px ${tema.sepLine}`} aria-hidden="true" />
            <span>— {g.label} —</span>
            <span className={`flex-1 h-px ${tema.sepLine}`} aria-hidden="true" />
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                         mobile-landscape:grid-cols-2 gap-3">
            {g.items
              .sort((a, b) => (a.ordine - b.ordine) || a.nome_item.localeCompare(b.nome_item))
              .map(p => (
                <PietanzaCard
                  key={p.nome_item}
                  pietanza={p}
                  badgeBg={tema.badgeBg}
                  onReady={() => onPietanzaReady(p.nome_item)}
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function PietanzaCard({ pietanza, badgeBg, onReady }) {
  const [busy, setBusy] = useState(false)
  return (
    <li className="card">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-xl font-bold flex-1 min-w-0 break-words whitespace-normal">
          {pietanza.nome_item}
        </h3>
        <span className={`${badgeBg} text-white font-bold px-3 py-1 rounded-full
                          text-sm shrink-0 whitespace-nowrap`}>
          TOT: {pietanza.total_qty}
        </span>
      </div>

      <p className="text-sm opacity-80 mb-3 break-words">
        {pietanza.byTavolo.map(t => `Tav.${t.tavolo} ×${t.qty}`).join(' · ')}
      </p>

      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try { await onReady() } finally { setBusy(false) }
        }}
        className="btn-success w-full"
      >
        {busy ? 'Aggiornamento…' : 'Tutto Pronto'}
      </button>
    </li>
  )
}
