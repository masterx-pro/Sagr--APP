import { useEffect, useMemo, useState, useRef } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import TableBadge from '../components/TableBadge.jsx'
import ServizioBadge from '../components/ServizioBadge.jsx'
import { getServizioAttuale } from '../utils/servizio.js'
import {
  groupByMandata,
  getStatoMandataDisplay,
  getMandataAttiva,
  getMandataProntaAt,
  timerMandataScaduto,
  secondiRimanentiTimerMandata,
  formatCountdownSec,
} from '../utils/mandateUtils.js'

/**
 * StationPage v5:
 *
 * Filtraggio items per categoria:
 *   - CUCINA: categoria='cucina' AND mandata IN (1,2,3)   (M4 esclusa)
 *   - BAR:    categoria='bar' (sempre)
 *             OR (mandata=4 AND mandata_stato != 'in_attesa')  ← anche dolci cucina!
 *
 * Blocco sequenziale CUCINA: M2 disponibile solo se M1='pronta'; M3 se M2='pronta'.
 *
 * Pulsanti progressivi (cucina e bar):
 *   in_attesa       → [📋 Da preparare]     (in_preparazione)
 *   in_preparazione → [🔄 In preparazione]  (pronta)
 *   pronta          → [✅ Pronto]           (no click)
 *
 * Dopo "Pronto", il barista deve fare swipe sx/dx per rimuovere la card.
 * In cucina: i tavoli "completati" (tutte le mandate pronte/consegnate)
 * scendono in fondo con badge "✅ Completato" e si rimuovono via swipe.
 */

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

// Filtro items "miei" in base a categoria della stazione.
function itemsDellaStazione(orderItems, categoria) {
  const items = orderItems || []
  if (categoria === 'cucina') {
    return items.filter(i => i.categoria === 'cucina' && (i.mandata ?? 1) < 4)
  }
  // bar
  return items.filter(i =>
    i.categoria === 'bar'
    || (i.mandata === 4 && i.mandata_stato !== 'in_attesa')
  )
}

const TICK_MS = 15_000

export default function StationPage({ user, onLogout, categoria, titolo, coloreHeader }) {
  const [orders, setOrders] = useState([])
  const [impostazioni, setImpostazioni] = useState({})
  const [view, setView] = useState('per-tavolo')
  const { markMandataInPreparazione, markMandataReady, fetchImpostazioni } = useOrders()
  const [refreshTick, setRefreshTick] = useState(0)
  const [servizioCorrente, setServizioCorrente] = useState(getServizioAttuale())
  // Set di orderId che il barista/cuoco ha "dismissato" via swipe
  const [dismissedIds, setDismissedIds] = useState(() => new Set())

  const dismiss = (orderId) => setDismissedIds(s => {
    const n = new Set(s); n.add(orderId); return n
  })

  const load = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, numero_tavolo, n_persone, nome_cliente, created_at, note, servizio, stato, tipo_pagamento, order_items(*, menu_items(ordine))')
      .in('stato', ['confermato', 'stornato'])
      .eq('servizio', servizioCorrente)
      .order('created_at', { ascending: true })
    if (error) { console.error(error); return }
    // Tengo solo ordini con almeno un item "mio"
    const filtrati = (data || []).filter(o => itemsDellaStazione(o.order_items, categoria).length > 0)
    setOrders(filtrati)
  }

  useEffect(() => { load() }, [refreshTick, categoria, servizioCorrente])

  useEffect(() => {
    fetchImpostazioni().then(setImpostazioni).catch(() => {})
  }, [fetchImpostazioni])

  useEffect(() => {
    const interval = setInterval(() => {
      const nuovo = getServizioAttuale()
      if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
    }, 60_000)
    return () => clearInterval(interval)
  }, [servizioCorrente])

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

  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // Ordini "visibili" = non dismissati localmente
  const ordersVisibili = useMemo(
    () => orders.filter(o => !dismissedIds.has(o.id)),
    [orders, dismissedIds]
  )

  return (
    <div className="min-h-screen flex flex-col">
      <header className={`${coloreHeader} px-4 py-3 flex items-center justify-between
                          sticky top-0 z-20 mobile-landscape:py-2`}>
        <div className="min-w-0">
          <h1 className="font-bold text-lg mobile-landscape:text-base">{titolo}</h1>
          <p className="text-xs opacity-90 truncate">{user.nome}</p>
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

      <nav className="grid grid-cols-2 gap-1 p-2 bg-pannello border-b border-bordo
                      sticky top-[3.25rem] z-10 mobile-landscape:top-[2.5rem]
                      mobile-landscape:p-1">
        <TabBtn active={view === 'per-tavolo'} coloreHeader={coloreHeader} onClick={() => setView('per-tavolo')}>📋 Per Tavolo</TabBtn>
        <TabBtn active={view === 'aggregato'}  coloreHeader={coloreHeader} onClick={() => setView('aggregato')}>📊 Aggregato</TabBtn>
      </nav>

      <main className="flex-1 p-4 mobile-landscape:p-3">
        {ordersVisibili.length === 0 ? (
          <p className="text-center text-2xl opacity-60 py-16
                        mobile-landscape:py-6 mobile-landscape:text-xl">
            Tutto pronto 🎉
          </p>
        ) : view === 'per-tavolo' ? (
          <VistaPerTavolo
            orders={ordersVisibili}
            categoria={categoria}
            impostazioni={impostazioni}
            onMandataInPreparazione={async (orderId, mandataNum) => {
              try { await markMandataInPreparazione(orderId, mandataNum, categoria); setRefreshTick(t => t + 1) }
              catch (e) { alert('Errore: ' + (e.message || e)) }
            }}
            onMandataPronta={async (orderId, mandataNum) => {
              try { await markMandataReady(orderId, mandataNum, categoria); setRefreshTick(t => t + 1) }
              catch (e) { alert('Errore: ' + (e.message || e)) }
            }}
            onDismiss={dismiss}
          />
        ) : (
          <VistaAggregata orders={ordersVisibili} categoria={categoria} />
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

function VistaPerTavolo({ orders, categoria, impostazioni, onMandataInPreparazione, onMandataPronta, onDismiss }) {
  // Ordina: attivi in cima (cronologico), completati in fondo
  const { attivi, completati } = useMemo(() => {
    const a = [], c = []
    for (const o of orders) {
      const myItems = itemsDellaStazione(o.order_items, categoria)
      const tuttoFatto = myItems.length > 0 && myItems.every(i =>
        i.mandata_stato === 'pronta' || i.mandata_stato === 'consegnata'
      )
      if (tuttoFatto) c.push(o); else a.push(o)
    }
    return { attivi: a, completati: c }
  }, [orders, categoria])

  return (
    <>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                     mobile-landscape:grid-cols-2 gap-3">
        {attivi.map(order => (
          <StationCard
            key={order.id}
            order={order}
            categoria={categoria}
            impostazioni={impostazioni}
            completato={false}
            onInPreparazione={(m) => onMandataInPreparazione(order.id, m)}
            onPronta={(m) => onMandataPronta(order.id, m)}
            onDismiss={() => onDismiss(order.id)}
          />
        ))}
      </ul>

      {completati.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-xs uppercase tracking-widest opacity-70">
            ✅ Completati ({completati.length}) — swipe per rimuovere
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                         mobile-landscape:grid-cols-2 gap-3">
            {completati.map(order => (
              <StationCard
                key={order.id}
                order={order}
                categoria={categoria}
                impostazioni={impostazioni}
                completato={true}
                onInPreparazione={(m) => onMandataInPreparazione(order.id, m)}
                onPronta={(m) => onMandataPronta(order.id, m)}
                onDismiss={() => onDismiss(order.id)}
              />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

// -------------------- SWIPE WRAPPER --------------------

function useSwipeToDismiss(onDismiss, abilitato) {
  const [dragX, setDragX] = useState(0)
  const [animatingOut, setAnimatingOut] = useState(false)
  const startX = useRef(null)

  const onTouchStart = (e) => {
    if (!abilitato || animatingOut) return
    startX.current = e.touches[0].clientX
  }
  const onTouchMove = (e) => {
    if (!abilitato || animatingOut || startX.current == null) return
    setDragX(e.touches[0].clientX - startX.current)
  }
  const onTouchEnd = () => {
    if (!abilitato || animatingOut) return
    if (Math.abs(dragX) > 80) {
      // Vola fuori e dismiss
      setAnimatingOut(true)
      setDragX(dragX > 0 ? 600 : -600)
      setTimeout(() => onDismiss(), 220)
    } else {
      setDragX(0)
    }
    startX.current = null
  }

  const style = {
    transform: `translateX(${dragX}px)`,
    transition: startX.current == null || animatingOut ? 'transform 200ms ease-out, opacity 200ms ease-out' : 'none',
    opacity: animatingOut ? 0 : 1,
    touchAction: 'pan-y',
  }

  return { dragHandlers: { onTouchStart, onTouchMove, onTouchEnd }, style }
}

function StationCard({ order, categoria, impostazioni, completato, onInPreparazione, onPronta, onDismiss }) {
  const myItems = itemsDellaStazione(order.order_items, categoria)
  const groupsByMandata = groupByMandata(myItems)
  const numeri = Object.keys(groupsByMandata).map(Number).sort((a, b) => a - b)
  const stornato = order.stato === 'stornato'

  // Le mandate sono ATTIVE (in_attesa/in_preparazione) o ARCHIVIATE (pronta/consegnata).
  const { attive, archiviate } = useMemo(() => {
    const a = [], ar = []
    for (const n of numeri) {
      const s = getStatoMandataDisplay(groupsByMandata[n])
      if (s === 'pronta' || s === 'consegnata') ar.push(n); else a.push(n)
    }
    return { attive: a, archiviate: ar }
  }, [numeri, groupsByMandata])

  // Blocco sequenziale CUCINA: M2 disponibile se M1 archiviata, M3 se M2 archiviata.
  // Per BAR il blocco non si applica: le mandate bar possono procedere in parallelo.
  const mandataBloccata = (n) => {
    if (categoria !== 'cucina') return false
    if (n === 1) return false
    const prec = n - 1
    if (!numeri.includes(prec)) return false
    const sPrec = getStatoMandataDisplay(groupsByMandata[prec])
    return sPrec !== 'pronta' && sPrec !== 'consegnata'
  }

  // Timer per la mandata successiva (dopo che la precedente e' pronta)
  const timerPerMandata = useMemo(() => {
    const out = {}
    for (const n of attive) {
      const prec = [...numeri].reverse().find(x => x < n && getStatoMandataDisplay(groupsByMandata[x]) === 'pronta')
      if (prec == null) continue
      const proAt = getMandataProntaAt(groupsByMandata[prec])
      if (!proAt) continue
      out[n] = {
        scaduto: timerMandataScaduto(proAt, impostazioni),
        secondi: secondiRimanentiTimerMandata(proAt, impostazioni),
      }
    }
    return out
  }, [attive, numeri, groupsByMandata, impostazioni])

  // Swipe disponibile se: bar+tutte pronte/consegnate, oppure cucina+completato
  const swipeAbilitato = !stornato && (
    (categoria === 'bar'    && attive.length === 0) ||
    (categoria === 'cucina' && completato)
  )
  const { dragHandlers, style } = useSwipeToDismiss(onDismiss, swipeAbilitato)

  const sfondoCompletato = completato ? 'bg-gray-900/40 opacity-80' : ''

  return (
    <li
      className={`card relative overflow-hidden ${sfondoCompletato}`}
      style={style}
      {...dragHandlers}
    >
      {/* Bottone X (desktop fallback per swipe) */}
      {swipeAbilitato && (
        <button
          onClick={onDismiss}
          aria-label="Rimuovi card"
          title="Rimuovi card"
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white text-sm
                     z-20 flex items-center justify-center active:scale-90"
        >
          ✕
        </button>
      )}

      {stornato && (
        <div className="absolute inset-0 z-10 pointer-events-none
                        bg-red-900/40 border-2 border-red-600 rounded-xl
                        flex items-start justify-center pt-2">
          <span className="badge bg-red-700 text-white font-bold animate-pulse">
            ⚠️ IN PAUSA — ATTENDI CONFERMA CASSA
          </span>
        </div>
      )}

      <div className={stornato ? 'opacity-60' : ''}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2 pr-8">
          <div className="flex items-center gap-2 flex-wrap">
            <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg" />
            {order.nome_cliente && <span className="font-bold">· {order.nome_cliente}</span>}
            {order.tipo_pagamento === 'bancomat' && <span title="bancomat">💳</span>}
            {order.tipo_pagamento === 'contanti' && <span title="contanti">💵</span>}
            {completato && (
              <span className="badge bg-blue-700 text-white text-xs">✅ Completato</span>
            )}
          </div>
          <span className="text-sm opacity-80">
            {new Date(order.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {order.note && (
          <p className="text-sm bg-yellow-900/40 border border-yellow-700 rounded-xl p-2 mb-2">
            Note: {order.note}
          </p>
        )}

        <div className="space-y-3">
          {attive.map(n => (
            <MandataBlock
              key={n}
              numero={n}
              items={groupsByMandata[n]}
              categoria={categoria}
              timer={timerPerMandata[n]}
              bloccata={mandataBloccata(n)}
              disabledByStorno={stornato}
              onInPreparazione={() => onInPreparazione(n)}
              onPronta={() => onPronta(n)}
            />
          ))}
          {archiviate.map(n => (
            <MandataArchivedBlock
              key={n}
              numero={n}
              items={groupsByMandata[n]}
              categoria={categoria}
            />
          ))}
        </div>
      </div>
    </li>
  )
}

function aggregaPerNome(items) {
  const map = new Map()
  for (const it of items) {
    const ordine = it.menu_items?.ordine ?? it.ordine ?? 99
    const cur = map.get(it.nome_item) || { nome: it.nome_item, ordine, q: 0 }
    cur.q += it.quantita
    map.set(it.nome_item, cur)
  }
  return Array.from(map.values())
}

function MandataBlock({ numero, items, categoria, timer, bloccata, disabledByStorno, onInPreparazione, onPronta }) {
  const stato = getStatoMandataDisplay(items)
  const [busy, setBusy] = useState(false)

  const urgente = !disabledByStorno && !bloccata && timer?.scaduto

  let bordoCls = 'border-l-yellow-500 bg-yellow-900/15'
  if (bloccata)                         bordoCls = 'border-l-gray-600 bg-gray-800/40 opacity-50'
  else if (urgente)                     bordoCls = 'border-l-red-500 bg-red-900/25 animate-pulse'
  else if (stato === 'in_preparazione') bordoCls = 'border-l-orange-500 bg-orange-900/20'

  const aggr = useMemo(() => aggregaPerNome(items), [items])

  const header = (() => {
    if (bloccata)           return `M${numero} · ⏳ In attesa di M${numero - 1}`
    if (urgente)            return `M${numero} · 🔴 URGENTE`
    if (timer?.secondi != null && timer.secondi > 0)
                            return `M${numero} · ⏱ ${formatCountdownSec(timer.secondi)} al via`
    if (stato === 'in_preparazione')
                            return `M${numero} · 🔄 in preparazione`
    return `M${numero} · ⏳ da preparare`
  })()

  const handler = stato === 'in_attesa' ? onInPreparazione : onPronta
  const btnLabel = stato === 'in_attesa' ? '📋 Da preparare' : '🔄 In preparazione'
  const btnBg    = stato === 'in_attesa' ? 'bg-blue-700' : 'bg-orange-600'
  const showBtn  = !disabledByStorno && !bloccata

  const renderRiga = ({ nome, q }) => (
    <li key={nome} className="flex items-start justify-between gap-3 text-lg">
      <span className="font-semibold flex-1 min-w-0 break-words whitespace-normal">{nome}</span>
      <span className="font-bold text-xl shrink-0">× {q}</span>
    </li>
  )

  return (
    <div className={`border-l-4 ${bordoCls} rounded-r-lg p-2`}>
      <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-widest opacity-90">
        <span>━━ {header} ━━</span>
      </div>

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

      {showBtn && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try { await handler() } finally { setBusy(false) }
          }}
          className={`${btnBg} text-white w-full rounded-xl py-2 font-bold text-base active:scale-95`}
        >
          {busy ? 'Aggiornamento…' : btnLabel}
        </button>
      )}
    </div>
  )
}

function MandataArchivedBlock({ numero, items }) {
  const stato = getStatoMandataDisplay(items)
  const aggr = useMemo(() => aggregaPerNome(items), [items])
  const consegnata = stato === 'consegnata'
  const bordoCls = consegnata
    ? 'border-l-blue-500 bg-blue-900/10 opacity-60'
    : 'border-l-green-500 bg-green-900/15 opacity-70'
  const icon = consegnata ? '✅ consegnata' : '✅ Pronto'

  return (
    <div className={`border-l-4 ${bordoCls} rounded-r-lg p-2`}>
      <div className="text-xs font-bold uppercase tracking-widest opacity-90 mb-1">
        ━━ M{numero} · {icon} ━━
      </div>
      <p className="text-sm break-words">
        {aggr.map(a => `${a.nome} ×${a.q}`).join(' · ')}
      </p>
    </div>
  )
}

// -------------------- VISTA AGGREGATA --------------------
//
// Mostra SOLO items che la stazione deve ancora preparare:
// mandata_stato IN ('in_attesa', 'in_preparazione').
// Escludi pronta, consegnata, in_pausa.

function VistaAggregata({ orders, categoria }) {
  const aggregated = useMemo(() => {
    const map = new Map()
    for (const order of orders) {
      if (order.stato === 'stornato') continue
      const myItems = itemsDellaStazione(order.order_items, categoria)

      for (const it of myItems) {
        if (!['in_attesa', 'in_preparazione'].includes(it.mandata_stato)) continue
        // Bar M4 visibile solo se sbloccata (in_preparazione)
        if (categoria === 'bar' && it.mandata === 4 && it.mandata_stato === 'in_attesa') continue

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
    return <p className="text-center text-xl opacity-60 py-12">Nulla da preparare 🎉</p>
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
