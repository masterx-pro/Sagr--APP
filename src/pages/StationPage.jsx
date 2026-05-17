import { useEffect, useMemo, useState, useRef } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import { useImpostazioni } from '../context/ImpostazioniContext.jsx'
import TableBadge from '../components/TableBadge.jsx'
import RoleHeader, { HeaderExitBtn } from '../components/RoleHeader.jsx'
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
 *   - BAR:    categoria='bar' AND (mandata != 4 OR mandata_stato != 'in_attesa')
 *             OR (categoria='cucina' AND mandata=4 AND mandata_stato != 'in_attesa')
 *             → M4 (sia caffe'/amari bar sia dolci cucina) bloccata finche'
 *               il cameriere non preme "Invia M4".
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
// Regola M4: gli items in mandata 4 (caffe'/amari bar + dolci cucina)
// restano nascosti finche' il cameriere non preme "Invia M4"
// (mandata_stato passa da 'in_attesa' a 'in_preparazione').
function itemsDellaStazione(orderItems, categoria) {
  const items = orderItems || []
  if (categoria === 'cucina') {
    return items.filter(i => i.categoria === 'cucina' && (i.mandata ?? 1) < 4)
  }
  // bar: voci bar tranne M4 in_attesa, piu' i dolci cucina M4 sbloccati.
  return items.filter(i => {
    const m4Bloccata = i.mandata === 4 && i.mandata_stato === 'in_attesa'
    if (i.categoria === 'bar')    return !m4Bloccata
    if (i.categoria === 'cucina') return i.mandata === 4 && !m4Bloccata
    return false
  })
}

const TICK_MS = 15_000

export default function StationPage({ user, onLogout, categoria, titolo, role }) {
  const [orders, setOrders] = useState([])
  const { impostazioni } = useImpostazioni()
  const [view, setView] = useState('per-tavolo')
  const { markMandataInPreparazione, markMandataReady } = useOrders()
  const [refreshTick, setRefreshTick] = useState(0)
  const [servizioCorrente, setServizioCorrente] = useState(() => getServizioAttuale())
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

  useEffect(() => {
    // order_items: ascoltiamo solo UPDATE (cambio mandata_stato).
    //   I nuovi item arrivano via INSERT su orders -> refetch.
    // orders: filtrato per servizio corrente per ridurre il traffico.
    const channel = supabase
      .channel(`station-${categoria}-${servizioCorrente}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_items' },
        () => setRefreshTick(t => t + 1))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `servizio=eq.${servizioCorrente}` },
        () => setRefreshTick(t => t + 1))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [categoria, servizioCorrente])

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

  const stornatoCount = orders.filter(o => o.stato === 'stornato').length
  const attiviCount = orders.length - stornatoCount

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <RoleHeader
        role={role || categoria}
        title={titolo}
        subtitle={user.nome}
        impostazioni={impostazioni}
        right={<HeaderExitBtn onClick={onLogout} />}
      />

      <div className="px-4 pt-3 pb-1 flex items-center gap-2 flex-wrap">
        {stornatoCount > 0 && (
          <span className="pill bg-dangerSoft text-danger border border-danger/40 animate-blink">
            ⚠ {stornatoCount} stornat{stornatoCount === 1 ? 'o' : 'i'}
          </span>
        )}
        <span className="pill bg-surfaceElev text-textSoft border border-border">
          {attiviCount} attiv{attiviCount === 1 ? 'o' : 'i'}
        </span>
      </div>

      <nav className="px-4 pt-3 sticky top-[unset] z-10">
        <div className="grid grid-cols-2 gap-1 p-1 bg-surface border border-border rounded-card">
          <TabBtn active={view === 'per-tavolo'} onClick={() => setView('per-tavolo')}>📋 Per Tavolo</TabBtn>
          <TabBtn active={view === 'aggregato'}  onClick={() => setView('aggregato')}>📊 Aggregato</TabBtn>
        </div>
      </nav>

      <main className="flex-1 p-4 mobile-landscape:p-3">
        {ordersVisibili.length === 0 ? (
          <div className="text-center py-16 mobile-landscape:py-6">
            <p className="font-display text-[28px] text-text mb-1">Tutto pronto 🎉</p>
            <p className="text-textSoft text-[14px] font-semibold">Nessun ordine da preparare</p>
          </div>
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

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-[44px] rounded-btn font-extrabold text-[13px] sm:text-[14px]
                  tracking-[0.3px] active:scale-95 transition-transform
                  mobile-landscape:min-h-[36px] mobile-landscape:rounded-lg
                  mobile-landscape:text-xs ${
        active
          ? 'bg-gold text-bg shadow-[0_2px_8px_rgba(212,160,67,0.4)]'
          : 'bg-transparent text-textSoft'
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
          <h2 className="mt-6 mb-2 text-[11px] font-extrabold uppercase tracking-[1.4px] text-textMute">
            ✅ Completati ({completati.length}) · swipe per rimuovere
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

  const cardBase = `relative overflow-hidden bg-surface border rounded-card-lg p-4 shadow-md
                    ${stornato ? 'border-danger shadow-alert' : 'border-borderSoft'}
                    ${completato ? 'opacity-70' : ''}`

  return (
    <li
      className={cardBase}
      style={style}
      {...dragHandlers}
    >
      {/* Bottone X (desktop fallback per swipe) */}
      {swipeAbilitato && (
        <button
          onClick={onDismiss}
          aria-label="Rimuovi card"
          title="Rimuovi card"
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-bg/60 border border-border text-textSoft text-sm
                     z-20 flex items-center justify-center active:scale-90"
        >
          ✕
        </button>
      )}

      {stornato && (
        <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none
                        flex justify-center">
          <span className="pill bg-dangerSoft text-danger border border-danger animate-blink">
            ⚠ STORNATO · IN PAUSA · ATTENDI CASSA
          </span>
        </div>
      )}

      <div className={stornato ? 'opacity-60 pt-6' : ''}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2 pr-8">
          <div className="flex items-center gap-2 flex-wrap">
            <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg"
                        variant={stornato ? 'danger' : 'wine'} />
            {order.nome_cliente && <span className="font-extrabold text-text text-[16px]">· {order.nome_cliente}</span>}
            {order.tipo_pagamento === 'bancomat' && (
              <span className="pill bg-infoSoft text-info text-[10px]">💳 BANC</span>
            )}
            {order.tipo_pagamento === 'contanti' && (
              <span className="pill bg-successSoft text-success text-[10px]">💵 CONT</span>
            )}
            {completato && (
              <span className="pill bg-infoSoft text-info text-[10px]">✅ Completato</span>
            )}
          </div>
          <span className="text-[12px] text-textSoft tabular-nums font-semibold">
            {new Date(order.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {order.note && (
          <p className="text-[13px] bg-warningSoft border border-warning/40 text-warning rounded-card p-2.5 mb-2">
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

  // border + glow
  let borderCls = 'border-border'
  let glowCls = 'shadow-sm'
  let bgCls = 'bg-surface'
  if (bloccata) { borderCls = 'border-borderSoft'; bgCls = 'bg-[rgba(196,168,130,0.04)]' }
  else if (urgente) { borderCls = 'border-danger'; glowCls = 'shadow-alert' }
  else if (stato === 'in_preparazione') { borderCls = 'border-warning' }
  else if (stato === 'in_attesa') { borderCls = 'border-borderSoft' }

  const aggr = useMemo(() => aggregaPerNome(items), [items])

  // Header status
  let headerColor = 'text-textSoft'
  let icon = '⏳'
  let label = 'DA PREPARARE'
  if (bloccata) {
    headerColor = 'text-textMute'; icon = '🔒'
    label = `IN ATTESA M${numero - 1}`
  } else if (urgente) {
    headerColor = 'text-danger'; icon = '🔴'; label = 'URGENTE'
  } else if (timer?.secondi != null && timer.secondi > 0) {
    headerColor = 'text-textSoft'; icon = '⏱'
    label = `${formatCountdownSec(timer.secondi)} al via`
  } else if (stato === 'in_preparazione') {
    headerColor = 'text-warning'; icon = '🔄'; label = 'IN PREPARAZIONE'
  }

  const sourceIcon = categoria === 'cucina' ? '🍳' : '🍺'

  const handler = stato === 'in_attesa' ? onInPreparazione : onPronta
  const btnLabel = stato === 'in_attesa' ? '→ In preparazione' : '→ Pronto'
  const btnBg    = stato === 'in_attesa' ? 'bg-gold text-bg' : 'bg-success text-bg'
  const showBtn  = !disabledByStorno && !bloccata

  const renderRiga = ({ nome, q }) => (
    <li key={nome}
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px]
                   bg-[rgba(196,168,130,0.06)] border border-borderSoft">
      <span className="min-w-[40px] h-[32px] px-2 rounded-badge inline-flex items-center justify-center
                       bg-surfaceElev text-text font-extrabold text-[16px] tabular-nums border border-border">
        {q}×
      </span>
      <span className="flex-1 text-[15px] font-semibold break-words text-text">{nome}</span>
    </li>
  )

  return (
    <div className={`relative rounded-card p-3 border-[1.5px] ${borderCls} ${glowCls} ${bgCls}
                     ${urgente ? 'animate-pulseUrgent' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-[9px]
                           bg-surfaceElev border border-border text-base">
            {sourceIcon}
          </span>
          <div>
            <div className="text-[14px] font-extrabold tracking-[0.4px] text-text">
              MANDATA {numero}
              {urgente && (
                <span className="ml-1.5 text-danger text-[11px] font-extrabold animate-blink">⚡</span>
              )}
            </div>
            <div className={`text-[11px] font-bold uppercase tracking-[0.4px] mt-[1px] ${headerColor}`}>
              {icon} {label}
            </div>
          </div>
        </div>
      </div>

      <ul className={`flex flex-col gap-1.5 mb-2 ${bloccata ? 'opacity-55' : ''}`}>
        {categoria === 'cucina'
          ? groupByPortata(aggr, PORTATE_CUCINA).flatMap(g => [
              <li key={`hdr-${g.label}`}
                  className="text-[10px] uppercase tracking-[1.2px] font-extrabold text-textMute mt-1 first:mt-0 px-1">
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
          className={`${btnBg} w-full min-h-[50px] rounded-btn py-2 font-extrabold text-[15px]
                     tracking-[0.4px] shadow-[0_3px_0_#3F2A1F]
                     active:scale-95 transition-transform
                     disabled:opacity-50 disabled:active:scale-100`}
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
  const bg = consegnata ? 'bg-[rgba(196,168,130,0.06)] border-textMute/40' : 'bg-successSoft border-success/40'
  const ink = consegnata ? 'text-textMute' : 'text-success'
  const icon = consegnata ? '✓ Consegnata' : '✅ Pronto'

  return (
    <div className={`rounded-card p-3 border-[1.5px] ${bg} opacity-80`}>
      <div className={`text-[11px] font-extrabold uppercase tracking-[0.4px] mb-1.5 ${ink}`}>
        MANDATA {numero} · {icon}
      </div>
      <p className="text-[13px] text-text break-words">
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

  if (aggregated.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="font-display text-[24px] text-text mb-1">Nulla da preparare 🎉</p>
        <p className="text-textSoft text-[13px] font-semibold">Tutta la coda smaltita</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map(g => (
        <section key={g.label}>
          <h2 className="flex items-center gap-2 mb-3 text-[11px] font-extrabold uppercase
                          tracking-[1.4px] text-textSoft select-none">
            <span className="flex-1 h-px bg-divider" aria-hidden="true" />
            <span>— {g.label} —</span>
            <span className="flex-1 h-px bg-divider" aria-hidden="true" />
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                         mobile-landscape:grid-cols-2 gap-3">
            {g.items
              .sort((a, b) => (a.ordine - b.ordine) || a.nome_item.localeCompare(b.nome_item))
              .map(p => (
                <PietanzaCard key={p.nome_item} pietanza={p} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function PietanzaCard({ pietanza }) {
  return (
    <li className="bg-surface border border-borderSoft rounded-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-[18px] font-extrabold text-text flex-1 min-w-0 break-words">
          {pietanza.nome_item}
        </h3>
        <span className="bg-gold text-bg font-extrabold px-3 py-1 rounded-phone tabular-nums
                         text-[13px] shrink-0 whitespace-nowrap shadow-cta">
          TOT: {pietanza.total_qty}
        </span>
      </div>
      <p className="text-[12.5px] text-textSoft font-semibold break-words">
        {pietanza.byTavolo.map(t => `Tav.${t.tavolo} ×${t.qty}`).join(' · ')}
      </p>
    </li>
  )
}
