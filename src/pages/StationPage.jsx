import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import TableBadge from '../components/TableBadge.jsx'
import ServizioBadge from '../components/ServizioBadge.jsx'
import { getServizioAttuale } from '../utils/servizio.js'
import {
  groupByMandata,
  getNumeriMandata,
  getStatoMandataDisplay,
  getMandataAttiva,
  calcolaTimerScaduto,
  getPortataDominante,
} from '../utils/mandateUtils.js'

/**
 * StationPage v2: Bar e Cucina, due tab:
 *   📋 Per Tavolo  → ordini raggruppati per tavolo + mandate
 *   📊 Aggregato   → ordini raggruppati per pietanza (mandate attive)
 *
 * Filtri DB:
 *   stato IN ('confermato','stornato')
 *   servizio = corrente
 *
 * Mandata "visibile" =
 *   - cucina: tutte le mandate con almeno un item categoria=cucina
 *   - bar:    tutte le mandate con almeno un item categoria=bar
 *
 * Bar caffe'/amari (mandata=2 con mandata_stato='in_attesa') = bloccate
 * fino allo sblocco del cameriere. Quando passano 'in_preparazione' diventano
 * urgenti con bordo rosso immediato.
 *
 * Ordini stornati = overlay + badge IN PAUSA, esclusi dal conteggio aggregato.
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

const TICK_MS = 30_000

export default function StationPage({ user, onLogout, categoria, titolo, coloreHeader }) {
  const [orders, setOrders] = useState([])
  const [impostazioni, setImpostazioni] = useState({})
  const [view, setView] = useState('per-tavolo')
  const { markMandataReady, fetchImpostazioni } = useOrders()
  const [refreshTick, setRefreshTick] = useState(0)
  const [servizioCorrente, setServizioCorrente] = useState(getServizioAttuale())

  const load = async () => {
    // Bar/Cucina vedono SOLO ordini 'confermato' e 'stornato' del servizio corrente
    const { data, error } = await supabase
      .from('orders')
      .select('id, numero_tavolo, n_persone, nome_cliente, created_at, note, servizio, stato, order_items(*, menu_items(ordine))')
      .in('stato', ['confermato', 'stornato'])
      .eq('servizio', servizioCorrente)
      .order('created_at', { ascending: true })
    if (error) {
      console.error(error)
      return
    }
    // Tengo SOLO gli ordini che hanno almeno un item della mia categoria
    // ancora attivo (non consegnata). 'in_pausa' resta visibile come banner.
    const filtrati = (data || []).filter(o => {
      const myItems = (o.order_items || []).filter(i => i.categoria === categoria)
      return myItems.some(i => i.mandata_stato !== 'consegnata')
    })
    setOrders(filtrati)
  }

  useEffect(() => { load() }, [refreshTick, categoria, servizioCorrente])

  useEffect(() => {
    fetchImpostazioni().then(setImpostazioni).catch(() => {})
  }, [fetchImpostazioni])

  // Auto-switch pranzo/cena
  useEffect(() => {
    const interval = setInterval(() => {
      const nuovo = getServizioAttuale()
      if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
    }, 60_000)
    return () => clearInterval(interval)
  }, [servizioCorrente])

  // Realtime
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

  // Tick per aggiornare i timer in UI
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <header className={`${coloreHeader} px-4 py-3 flex items-center justify-between
                          sticky top-0 z-20 mobile-landscape:py-2`}>
        <div className="min-w-0">
          <h1 className="font-bold text-lg mobile-landscape:text-base">{titolo}</h1>
          <p className="text-xs opacity-90 truncate">{user.nome}</p>
        </div>
        <div className="flex items-center gap-2">
          <ServizioBadge />
          <button
            onClick={onLogout}
            className="px-3 py-2 rounded-lg bg-white/20 text-sm font-semibold"
          >
            Esci
          </button>
        </div>
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
        {orders.length === 0 ? (
          <p className="text-center text-2xl opacity-60 py-16
                        mobile-landscape:py-6 mobile-landscape:text-xl">
            Tutto pronto 🎉
          </p>
        ) : view === 'per-tavolo' ? (
          <VistaPerTavolo
            orders={orders}
            categoria={categoria}
            impostazioni={impostazioni}
            onMandataReady={async (orderId, mandataNum) => {
              try {
                await markMandataReady(orderId, mandataNum, categoria)
                setRefreshTick(t => t + 1)
              } catch (e) {
                alert('Errore: ' + (e.message || e))
              }
            }}
          />
        ) : (
          <VistaAggregata orders={orders} categoria={categoria} />
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

function VistaPerTavolo({ orders, categoria, impostazioni, onMandataReady }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                   mobile-landscape:grid-cols-2 gap-3">
      {orders.map(order => (
        <StationCard
          key={order.id}
          order={order}
          categoria={categoria}
          impostazioni={impostazioni}
          onMandataReady={onMandataReady}
        />
      ))}
    </ul>
  )
}

function StationCard({ order, categoria, impostazioni, onMandataReady }) {
  // Filtro solo i miei item; raggruppo per mandata.
  const myItems = (order.order_items || []).filter(i => i.categoria === categoria)
  const groupsByMandata = groupByMandata(myItems)
  const numeriMandata = getNumeriMandata(myItems)
  const stornato = order.stato === 'stornato'

  // La mandata "appena pronta" lato cucina/bar -> determina il timer per la successiva
  // Trovo per ogni mandata il piu' recente mandata_pronta_at e la portata dominante
  const mandataTimers = useMemo(() => {
    const out = {}
    for (const n of numeriMandata) {
      const items = groupsByMandata[n]
      const proxN = numeriMandata.find(x => x > n)
      if (!proxN) continue
      // Trova l'ultimo mandata_pronta_at della mandata corrente
      const tutti = items.map(i => i.mandata_pronta_at).filter(Boolean)
      if (tutti.length === 0) continue
      const ultimo = tutti.sort().slice(-1)[0]
      // Portata della mandata corrente (cucina)
      const portata = getPortataDominante(items, impostazioni) || 'primo'
      const scaduto = calcolaTimerScaduto(ultimo, portata, impostazioni)
      out[proxN] = { scaduto, portataPrec: portata }
    }
    return out
  }, [numeriMandata, groupsByMandata, impostazioni])

  return (
    <li className="card relative overflow-hidden">
      {stornato && (
        <div className="absolute inset-0 z-10 pointer-events-none
                        bg-red-900/40 border-2 border-red-600 rounded-xl
                        flex items-start justify-center pt-2">
          <span className="badge bg-red-700 text-white font-bold animate-pulse">
            ⚠️ IN PAUSA — ATTENDI CONFERMA CASSA
          </span>
        </div>
      )}

      <div className={`${stornato ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg" />
            {order.nome_cliente && (
              <span className="font-bold">· {order.nome_cliente}</span>
            )}
          </div>
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

        <div className="space-y-3">
          {numeriMandata.map(n => (
            <MandataBlock
              key={n}
              numero={n}
              items={groupsByMandata[n]}
              categoria={categoria}
              timer={mandataTimers[n]}
              disabledByStorno={stornato}
              onReady={() => onMandataReady(order.id, n)}
            />
          ))}
        </div>
      </div>
    </li>
  )
}

function MandataBlock({ numero, items, categoria, timer, disabledByStorno, onReady }) {
  const stato = getStatoMandataDisplay(items)
  const [busy, setBusy] = useState(false)

  // Aggregazione per nome_item dentro la mandata
  const aggr = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      const ordine = it.menu_items?.ordine ?? it.ordine ?? 99
      const cur = map.get(it.nome_item) || { nome: it.nome_item, ordine, q: 0 }
      cur.q += it.quantita
      map.set(it.nome_item, cur)
    }
    return Array.from(map.values())
  }, [items])

  // Bar mandata=2 con tutti gli item in_attesa = bloccata
  const barM2Bloccata = categoria === 'bar' && numero === 2
    && items.every(i => i.mandata_stato === 'in_attesa')

  // Urgenza:
  //   bar M2 sbloccata (in_preparazione) -> immediato rosso
  //   cucina: timer della mandata precedente scaduto -> rosso
  const urgente = !disabledByStorno && (
    (categoria === 'bar' && numero === 2 && stato === 'in_preparazione')
    || (timer?.scaduto && stato !== 'pronta' && stato !== 'consegnata')
  )

  const consegnata = stato === 'consegnata'
  const pronta = stato === 'pronta'

  // Stile bordo per stato
  let bordo = 'border-l-gray-500'
  let bg = 'bg-pannello'
  let opacity = ''
  if (consegnata) { bordo = 'border-l-blue-500'; bg = 'bg-blue-900/15'; opacity = 'opacity-70' }
  else if (pronta) { bordo = 'border-l-green-500'; bg = 'bg-green-900/20' }
  else if (urgente) { bordo = 'border-l-red-500'; bg = 'bg-red-900/25 animate-pulse' }
  else if (barM2Bloccata) { bordo = 'border-l-yellow-500'; bg = 'bg-yellow-900/10'; opacity = 'opacity-60' }
  else { bordo = 'border-l-yellow-500'; bg = 'bg-yellow-900/15' }

  const renderRiga = ({ nome, q }) => (
    <li key={nome} className="flex items-start justify-between gap-3 text-lg">
      <span className="font-semibold flex-1 min-w-0 break-words whitespace-normal">
        {nome}
      </span>
      <span className="font-bold text-xl shrink-0">× {q}</span>
    </li>
  )

  const headerLabel = (() => {
    if (consegnata) return `M${numero} · ✅ consegnata`
    if (pronta)     return `M${numero} · pronta`
    if (urgente)    return `M${numero} · 🔴 urgente`
    if (barM2Bloccata) return `M${numero} · 🔒 in attesa sblocco`
    return `M${numero}`
  })()

  return (
    <div className={`border-l-4 ${bordo} ${bg} ${opacity} rounded-r-lg p-2 transition-colors`}>
      <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-widest opacity-90">
        <span>━━ {headerLabel} ━━</span>
      </div>

      {barM2Bloccata ? (
        <p className="text-sm italic opacity-80 py-1">
          Caffè/amari in attesa di sblocco dal cameriere…
        </p>
      ) : (
        <ul className="space-y-1 mb-2">
          {categoria === 'cucina'
            ? groupByPortata(aggr, PORTATE_CUCINA).flatMap(g => [
                <li key={`hdr-${g.label}`}
                    className="text-[10px] uppercase tracking-widest opacity-70 mt-1 first:mt-0">
                  — {g.label} —
                </li>,
                ...g.items.map(renderRiga),
              ])
            : aggr.map(renderRiga)}
        </ul>
      )}

      {!consegnata && !pronta && !barM2Bloccata && (
        <button
          disabled={busy || disabledByStorno}
          onClick={async () => {
            setBusy(true)
            try { await onReady() } finally { setBusy(false) }
          }}
          className="btn-success w-full text-base"
        >
          {busy ? 'Aggiornamento…' : `✓ Pronta M${numero}`}
        </button>
      )}
    </div>
  )
}

// -------------------- VISTA AGGREGATA --------------------
//
// Conta SOLO gli item delle mandate attive (in_attesa, in_preparazione, pronta).
// Esclude consegnata e in_pausa (ordini stornati).
// Per il bar: mandata 2 viene mostrata SOLO quando 'in_preparazione' (sbloccata).

function VistaAggregata({ orders, categoria }) {
  const aggregated = useMemo(() => {
    const map = new Map()
    for (const order of orders) {
      if (order.stato === 'stornato') continue
      const myItems = (order.order_items || []).filter(i => i.categoria === categoria)
      // Mandata attiva tra i miei item
      const mAttiva = getMandataAttiva(myItems)
      if (mAttiva == null) continue

      for (const it of myItems) {
        // Solo items della mandata attiva
        if (it.mandata !== mAttiva) continue
        // Solo stati attivi
        if (!['in_attesa', 'in_preparazione', 'pronta'].includes(it.mandata_stato)) continue
        // Per il bar: mandata 2 visibile solo se sbloccata (in_preparazione o pronta)
        if (categoria === 'bar' && it.mandata === 2 && it.mandata_stato === 'in_attesa') continue

        const key = it.nome_item
        if (!map.has(key)) {
          map.set(key, {
            nome_item: it.nome_item,
            ordine: it.menu_items?.ordine ?? it.ordine ?? 99,
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
  }, [orders, categoria])

  const groups = useMemo(() => {
    const schema = categoria === 'cucina' ? PORTATE_CUCINA : PORTATE_BAR
    return groupByPortata(aggregated, schema)
  }, [aggregated, categoria])

  const tema = categoria === 'cucina'
    ? { sepText: 'text-cucina', sepLine: 'bg-cucina/40', badgeBg: 'bg-cucina' }
    : { sepText: 'text-bar',    sepLine: 'bg-bar/40',    badgeBg: 'bg-bar'    }

  if (aggregated.length === 0) {
    return (
      <p className="text-center text-xl opacity-60 py-12">
        Nessuna mandata attiva
      </p>
    )
  }

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
                <PietanzaCard key={p.nome_item} pietanza={p} badgeBg={tema.badgeBg} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function PietanzaCard({ pietanza, badgeBg }) {
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

      <p className="text-sm opacity-80 break-words">
        {pietanza.byTavolo.map(t => `Tav.${t.tavolo} ×${t.qty}`).join(' · ')}
      </p>
    </li>
  )
}
