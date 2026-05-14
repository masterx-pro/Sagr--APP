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
  getMandataProntaAt,
  timerMandataScaduto,
  secondiRimanentiTimerMandata,
  formatCountdownSec,
} from '../utils/mandateUtils.js'

/**
 * StationPage v3: Bar e Cucina, due tab:
 *   📋 Per Tavolo  → ordini con mandate progressive
 *   📊 Aggregato   → ordini raggruppati per pietanza (mandate attive)
 *
 * Flusso progressivo per ogni mandata:
 *   in_attesa       → [📋 Da preparare]      (click -> in_preparazione)
 *   in_preparazione → [🔄 In preparazione]   (click -> pronta)
 *   pronta          → [✅ Pronto] (no click, collassa in fondo)
 *
 * Timer mandata successiva: tempo_timer_mandate_min minuti dopo che la
 * mandata corrente e' marcata pronta, la successiva diventa rossa.
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

const TICK_MS = 15_000

export default function StationPage({ user, onLogout, categoria, titolo, coloreHeader }) {
  const [orders, setOrders] = useState([])
  const [impostazioni, setImpostazioni] = useState({})
  const [view, setView] = useState('per-tavolo')
  const { markMandataInPreparazione, markMandataReady, fetchImpostazioni } = useOrders()
  const [refreshTick, setRefreshTick] = useState(0)
  const [servizioCorrente, setServizioCorrente] = useState(getServizioAttuale())

  const load = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, numero_tavolo, n_persone, nome_cliente, created_at, note, servizio, stato, tipo_pagamento, order_items(*, menu_items(ordine))')
      .in('stato', ['confermato', 'stornato'])
      .eq('servizio', servizioCorrente)
      .order('created_at', { ascending: true })
    if (error) {
      console.error(error)
      return
    }
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
            onMandataInPreparazione={async (orderId, mandataNum) => {
              try { await markMandataInPreparazione(orderId, mandataNum, categoria); setRefreshTick(t => t + 1) }
              catch (e) { alert('Errore: ' + (e.message || e)) }
            }}
            onMandataPronta={async (orderId, mandataNum) => {
              try { await markMandataReady(orderId, mandataNum, categoria); setRefreshTick(t => t + 1) }
              catch (e) { alert('Errore: ' + (e.message || e)) }
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

function VistaPerTavolo({ orders, categoria, impostazioni, onMandataInPreparazione, onMandataPronta }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                   mobile-landscape:grid-cols-2 gap-3">
      {orders.map(order => (
        <StationCard
          key={order.id}
          order={order}
          categoria={categoria}
          impostazioni={impostazioni}
          onInPreparazione={(m) => onMandataInPreparazione(order.id, m)}
          onPronta={(m) => onMandataPronta(order.id, m)}
        />
      ))}
    </ul>
  )
}

function StationCard({ order, categoria, impostazioni, onInPreparazione, onPronta }) {
  const myItems = (order.order_items || []).filter(i => i.categoria === categoria)
  const groupsByMandata = groupByMandata(myItems)
  const numeri = getNumeriMandata(myItems)
  const stornato = order.stato === 'stornato'

  // Ordino le mandate: attive (non pronta/consegnata) in alto, pronte/consegnate in fondo.
  const { attive, archiviate } = useMemo(() => {
    const attive = [], archiviate = []
    for (const n of numeri) {
      const s = getStatoMandataDisplay(groupsByMandata[n])
      if (s === 'pronta' || s === 'consegnata') archiviate.push(n)
      else attive.push(n)
    }
    return { attive, archiviate }
  }, [numeri, groupsByMandata])

  // Timer per la mandata "successiva":
  //   per ogni mandata attiva, guardo se ESISTE una mandata precedente
  //   con stato 'pronta' (cioe' archiviata). Se si', leggo mandata_pronta_at
  //   piu' recente e calcolo se il timer e' scaduto.
  const timerPerMandata = useMemo(() => {
    const out = {}
    for (const n of attive) {
      const precedente = [...numeri].reverse().find(x => x < n && getStatoMandataDisplay(groupsByMandata[x]) === 'pronta')
      if (precedente == null) continue
      const proAt = getMandataProntaAt(groupsByMandata[precedente])
      if (!proAt) continue
      out[n] = {
        proAt,
        scaduto: timerMandataScaduto(proAt, impostazioni),
        secondi: secondiRimanentiTimerMandata(proAt, impostazioni),
      }
    }
    return out
  }, [attive, numeri, groupsByMandata, impostazioni])

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

      <div className={stornato ? 'opacity-60' : ''}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg" />
            {order.nome_cliente && (
              <span className="font-bold">· {order.nome_cliente}</span>
            )}
            {order.tipo_pagamento === 'bancomat' && <span title="bancomat">💳</span>}
            {order.tipo_pagamento === 'contanti' && <span title="contanti">💵</span>}
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

function MandataBlock({ numero, items, categoria, timer, disabledByStorno, onInPreparazione, onPronta }) {
  const stato = getStatoMandataDisplay(items)
  const [busy, setBusy] = useState(false)

  const barM4Bloccata = categoria === 'bar' && numero === 4
    && items.every(i => i.mandata_stato === 'in_attesa')

  const urgente = !disabledByStorno && timer?.scaduto

  // Stile bordo
  let bordoCls = 'border-l-yellow-500 bg-yellow-900/15'
  if (urgente)            bordoCls = 'border-l-red-500 bg-red-900/25 animate-pulse'
  else if (stato === 'in_preparazione') bordoCls = 'border-l-orange-500 bg-orange-900/20'
  else if (barM4Bloccata) bordoCls = 'border-l-yellow-500 bg-yellow-900/10 opacity-60'

  const aggr = useMemo(() => aggregaPerNome(items), [items])

  // Header label
  const header = (() => {
    if (urgente)            return `M${numero} · 🔴 URGENTE`
    if (barM4Bloccata)      return `M${numero} · 🔒 attesa sblocco cameriere`
    if (timer?.secondi != null && timer.secondi > 0)
                            return `M${numero} · ⏱ ${formatCountdownSec(timer.secondi)} al via`
    if (stato === 'in_preparazione')
                            return `M${numero} · 🔄 in preparazione`
    return `M${numero} · ⏳ da preparare`
  })()

  // Pulsante azione
  const handler = stato === 'in_attesa' ? onInPreparazione : onPronta
  const btnLabel = stato === 'in_attesa' ? '📋 Da preparare' : '🔄 In preparazione'
  const btnBg    = stato === 'in_attesa' ? 'bg-blue-700' : 'bg-orange-600'
  const showBtn  = !disabledByStorno && !barM4Bloccata

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

      {barM4Bloccata ? (
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

function MandataArchivedBlock({ numero, items, categoria }) {
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

function VistaAggregata({ orders, categoria }) {
  const aggregated = useMemo(() => {
    const map = new Map()
    for (const order of orders) {
      if (order.stato === 'stornato') continue
      const myItems = (order.order_items || []).filter(i => i.categoria === categoria)
      const mAttiva = getMandataAttiva(myItems)
      if (mAttiva == null) continue

      for (const it of myItems) {
        if (it.mandata !== mAttiva) continue
        if (!['in_attesa', 'in_preparazione', 'pronta'].includes(it.mandata_stato)) continue
        // Bar M4 visibile solo se sbloccata
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
    return <p className="text-center text-xl opacity-60 py-12">Nessuna mandata attiva</p>
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
