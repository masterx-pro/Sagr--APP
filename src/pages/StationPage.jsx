import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import { useImpostazioni } from '../context/ImpostazioniContext.jsx'
import TableBadge from '../components/TableBadge.jsx'
import RoleHeader, { HeaderExitBtn } from '../components/RoleHeader.jsx'
import { getServizioAttuale, getTimerPreRiscaldo } from '../utils/servizio.js'
import {
  groupByMandata,
  getStatoMandataDisplay,
  getPrioritaMandata,
  pesoPriorita,
  secondiRimanentiPreRiscaldo,
  getPortataDominante,
} from '../utils/mandateUtils.js'
import { getSottocategoriaFromOrdine } from '../utils/servizio.js'

/**
 * StationPage v5 — Kitchen Display System.
 *
 * Flusso stati (per categoria):
 *   in_attesa → pre_riscaldo → in_preparazione → in_finestra → consegnata
 *   in_attesa → sbloccata    → in_preparazione → in_finestra → consegnata
 *
 * Filtraggio items per categoria (visibilita' KDS):
 *   - CUCINA: categoria='cucina' AND mandata IN (1,2,3,4)
 *             (M4 visibile solo se mandata_stato != 'in_attesa', cioe' dopo
 *              che il cameriere ha premuto "Sblocca M4")
 *   - BAR:    categoria='bar' AND M1..M3 + M4 sbloccata
 *             OR dolci cucina M4 sbloccati
 *
 * Polling pre-riscaldo (solo cucina): ogni 30s controlla items in_attesa
 * di mandata N dove M(N-1) e' completamente in_finestra/consegnata e
 * promuove a pre_riscaldo con pre_riscaldo_at = now() (gia' scaduto).
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

// Items "miei" per la stazione.
// Regola M4: tutti gli items M4 (dolci + caffe' + amari) vivono sul BAR.
// La cucina non vede MAI items con mandata=4. Il bar vede M4 solo dopo
// che il cameriere ha premuto "Sblocca M4" (mandata_stato != 'in_attesa').
function itemsDellaStazione(orderItems, categoria) {
  const items = orderItems || []
  if (categoria === 'cucina') {
    return items.filter(i => i.categoria === 'cucina' && i.mandata !== 4)
  }
  // bar: voci bar tranne M4 in_attesa (bloccata, attende sblocco cameriere)
  return items.filter(i => {
    if (i.categoria !== 'bar') return false
    const m4Bloccata = i.mandata === 4 && i.mandata_stato === 'in_attesa'
    return !m4Bloccata
  })
}

const TICK_MS = 15_000           // tick per countdown UI
const POLL_PRE_RISCALDO_MS = 30_000  // polling promozione pre_riscaldo

export default function StationPage({ user, onLogout, categoria, titolo, role }) {
  const [orders, setOrders] = useState([])
  const { impostazioni } = useImpostazioni()
  const [view, setView] = useState('per-tavolo')
  const { markMandataInPreparazione, marcaInFinestra } = useOrders()
  const [refreshTick, setRefreshTick] = useState(0)
  const [servizioCorrente, setServizioCorrente] = useState(() => getServizioAttuale())
  const [dismissedIds, setDismissedIds] = useState(() => new Set())

  const dismiss = (orderId) => setDismissedIds(s => {
    const n = new Set(s); n.add(orderId); return n
  })

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, numero_tavolo, n_persone, nome_cliente, created_at, note, servizio, stato, tipo_pagamento, order_items(*, menu_items(ordine))')
      .in('stato', ['confermato', 'stornato'])
      .eq('servizio', servizioCorrente)
      .order('created_at', { ascending: true })
    if (error) { console.error(error); return }
    const filtrati = (data || []).filter(o => itemsDellaStazione(o.order_items, categoria).length > 0)
    setOrders(filtrati)
  }, [categoria, servizioCorrente])

  useEffect(() => { load() }, [load, refreshTick])

  useEffect(() => {
    const nuovo = getServizioAttuale(impostazioni)
    if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
  }, [impostazioni, servizioCorrente])

  useEffect(() => {
    const interval = setInterval(() => {
      const nuovo = getServizioAttuale(impostazioni)
      if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
    }, 60_000)
    return () => clearInterval(interval)
  }, [servizioCorrente, impostazioni])

  // Realtime: refresh su qualunque mutazione order_items/orders del servizio.
  useEffect(() => {
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

  // Tick per countdown timer
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // POLLING PRE-RISCALDO (solo cucina)
  // Ogni 30s: per ogni ordine, se M(N-1) e' tutta in_finestra/consegnata
  // e M(N) e' ancora in_attesa, promuovi M(N) → pre_riscaldo (scaduto).
  useEffect(() => {
    if (categoria !== 'cucina') return
    let active = true

    async function poll() {
      try {
        const idsDaPromuovere = []
        for (const order of orders) {
          const myItems = itemsDellaStazione(order.order_items, categoria)
          if (myItems.length === 0) continue
          const groups = groupByMandata(myItems)
          const numeri = Object.keys(groups).map(Number).sort((a, b) => a - b)
          for (let i = 1; i < numeri.length; i++) {
            const n = numeri[i]
            const prev = numeri[i - 1]
            const prevItems = groups[prev]
            const prevPronta = prevItems.every(it =>
              it.mandata_stato === 'in_finestra' || it.mandata_stato === 'consegnata'
            )
            if (!prevPronta) continue

            // Timer: usa la portata dominante della M(N) per scegliere
            // pre_riscaldo_X_min, e l'in_finestra_at piu' recente di M(N-1).
            const prevFinestraAt = Math.max(...prevItems
              .map(it => new Date(it.in_finestra_at || 0).getTime())
              .filter(t => Number.isFinite(t) && t > 0)
            )
            if (!prevFinestraAt || !Number.isFinite(prevFinestraAt)) continue

            const itemsConOrdine = (groups[n] || []).map(it => ({
              categoria: 'cucina',
              ordine: it.menu_items?.ordine ?? 0,
            }))
            const portata = getPortataDominante(itemsConOrdine, impostazioni) || 'primo'
            const timerMin = getTimerPreRiscaldo(portata, impostazioni)
            const scadenza = prevFinestraAt + timerMin * 60_000
            if (Date.now() < scadenza) continue

            for (const it of groups[n]) {
              if (it.mandata_stato === 'in_attesa') {
                idsDaPromuovere.push(it.id)
              }
            }
          }
        }

        if (active && idsDaPromuovere.length > 0) {
          await supabase
            .from('order_items')
            .update({
              mandata_stato: 'pre_riscaldo',
              pre_riscaldo_at: new Date().toISOString(),
            })
            .in('id', idsDaPromuovere)
            .eq('mandata_stato', 'in_attesa')   // re-check
          setRefreshTick(t => t + 1)
        }
      } catch (e) {
        console.warn('polling pre_riscaldo error:', e?.message || e)
      }
    }

    poll()
    const t = setInterval(poll, POLL_PRE_RISCALDO_MS)
    return () => { active = false; clearInterval(t) }
  }, [categoria, orders, impostazioni])

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
            onInPreparazione={async (orderId, mandataNum) => {
              try { await markMandataInPreparazione(orderId, mandataNum, categoria); setRefreshTick(t => t + 1) }
              catch (e) { alert('Errore: ' + (e.message || e)) }
            }}
            onInFinestra={async (orderId, mandataNum) => {
              try { await marcaInFinestra(orderId, mandataNum, categoria); setRefreshTick(t => t + 1) }
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

function VistaPerTavolo({ orders, categoria, impostazioni, onInPreparazione, onInFinestra, onDismiss }) {
  // Calcola priorita' max per ordine: serve a ordinare attivi → in fondo i completati.
  const conPriorita = useMemo(() => {
    return orders.map(o => {
      const myItems = itemsDellaStazione(o.order_items, categoria)
      const groups = groupByMandata(myItems)
      let pesoMax = 0
      let attive = []
      let inFinestra = []
      let consegnate = []
      for (const n of Object.keys(groups).map(Number).sort((a, b) => a - b)) {
        const prio = getPrioritaMandata(groups[n])
        const p = pesoPriorita(prio)
        if (p > pesoMax) pesoMax = p
        if (prio === 'consegnata') consegnate.push(n)
        else if (prio === 'in_finestra') inFinestra.push(n)
        else attive.push(n)
      }
      const tuttoFatto = attive.length === 0 && inFinestra.length === 0 && consegnate.length > 0
      return { order: o, myItems, groups, pesoMax, attive, inFinestra, consegnate, tuttoFatto }
    })
  }, [orders, categoria])

  // Suddivisione: attivi (in cima ordinati per peso decrescente, poi ora) vs completati
  const attivi = useMemo(
    () => conPriorita
      .filter(x => !x.tuttoFatto)
      .sort((a, b) => (b.pesoMax - a.pesoMax) || (new Date(a.order.created_at) - new Date(b.order.created_at))),
    [conPriorita]
  )
  const completati = useMemo(
    () => conPriorita.filter(x => x.tuttoFatto),
    [conPriorita]
  )

  return (
    <>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                     mobile-landscape:grid-cols-2 gap-3">
        {attivi.map(x => (
          <StationCard
            key={x.order.id}
            entry={x}
            categoria={categoria}
            impostazioni={impostazioni}
            completato={false}
            onInPreparazione={(m) => onInPreparazione(x.order.id, m)}
            onInFinestra={(m) => onInFinestra(x.order.id, m)}
            onDismiss={() => onDismiss(x.order.id)}
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
            {completati.map(x => (
              <StationCard
                key={x.order.id}
                entry={x}
                categoria={categoria}
                impostazioni={impostazioni}
                completato={true}
                onInPreparazione={(m) => onInPreparazione(x.order.id, m)}
                onInFinestra={(m) => onInFinestra(x.order.id, m)}
                onDismiss={() => onDismiss(x.order.id)}
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

function StationCard({ entry, categoria, impostazioni, completato, onInPreparazione, onInFinestra, onDismiss }) {
  const { order, groups, attive, inFinestra, consegnate } = entry
  const stornato = order.stato === 'stornato'

  // Swipe disponibile se ordine completo o bar con nulla di attivo
  const swipeAbilitato = !stornato && completato
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
        <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none flex justify-center">
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

        {/* 1. Mandate ATTIVE (sbloccata / pre_riscaldo / in_preparazione / in_attesa) */}
        <div className="flex flex-col gap-2.5">
          {attive.map(n => (
            <MandataBlockKDS
              key={n}
              numero={n}
              items={groups[n]}
              categoria={categoria}
              impostazioni={impostazioni}
              disabledByStorno={stornato}
              onInPreparazione={() => onInPreparazione(n)}
              onInFinestra={() => onInFinestra(n)}
            />
          ))}
        </div>

        {/* 2. Mandate IN FINESTRA (attendono cameriere) */}
        {inFinestra.length > 0 && (
          <div className="flex flex-col gap-2.5 mt-2.5">
            {inFinestra.map(n => (
              <MandataInFinestraBlock
                key={n}
                numero={n}
                items={groups[n]}
                categoria={categoria}
              />
            ))}
          </div>
        )}

        {/* 3. Mandate CONSEGNATE (collassate) */}
        {consegnate.length > 0 && (
          <div className="mt-2.5">
            <details className="bg-surface rounded-card border border-borderSoft px-3 py-2">
              <summary className="text-[11px] uppercase tracking-[1.4px] font-extrabold text-textMute cursor-pointer">
                ✅ {consegnate.length} mandat{consegnate.length === 1 ? 'a' : 'e'} consegnat{consegnate.length === 1 ? 'a' : 'e'}
              </summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {consegnate.map(n => {
                  const items = groups[n] || []
                  const ora = items
                    .map(it => it.mandata_consegnata_at)
                    .filter(Boolean)
                    .map(s => new Date(s))
                    .sort((a, b) => b - a)[0]
                  return (
                    <li key={n} className="text-[12px] text-textMute font-semibold tabular-nums flex justify-between">
                      <span>M{n} · {items.length} voci</span>
                      <span>{ora ? ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                    </li>
                  )
                })}
              </ul>
            </details>
          </div>
        )}
      </div>
    </li>
  )
}

// -------------------- MANDATA BLOCK (KDS) --------------------

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

function fmtCountdown(sec) {
  if (sec == null) return ''
  const abs = Math.abs(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  return `${sec < 0 ? '-' : ''}${m}:${String(s).padStart(2, '0')}`
}

function MandataBlockKDS({ numero, items, categoria, impostazioni, disabledByStorno, onInPreparazione, onInFinestra }) {
  const prio = getPrioritaMandata(items)
  const stato = getStatoMandataDisplay(items)
  const [busy, setBusy] = useState(false)

  // Token visivi per stato
  let borderCls = 'border-borderSoft'
  let bgCls = 'bg-surface'
  let extraCls = ''
  if (prio === 'urgente') {
    borderCls = 'border-danger'; bgCls = 'bg-surface'; extraCls = 'animate-pulseUrgent shadow-alert'
  } else if (prio === 'pre_riscaldo_scaduto') {
    borderCls = 'border-danger'; bgCls = 'bg-dangerSoft/30'; extraCls = 'shadow-alert'
  } else if (prio === 'pre_riscaldo') {
    borderCls = 'border-warning'; bgCls = 'bg-warningSoft/30'
  } else if (prio === 'in_preparazione') {
    borderCls = 'border-warning'; bgCls = 'bg-warningSoft/20'
  } else if (prio === 'in_attesa') {
    // Mandata bloccata, attende sblocco cameriere: sfondo grigio scuro
    borderCls = 'border-borderSoft'; bgCls = 'bg-surfaceElev/40'; extraCls = 'opacity-75'
  }

  // Label header
  let headerIcon = '⏳'
  let headerLabel = 'IN ATTESA SBLOCCO'
  let headerColor = 'text-textMute'
  if (prio === 'urgente')                 { headerIcon = '🔴'; headerLabel = 'URGENTE · SBLOCCATA'; headerColor = 'text-danger' }
  else if (prio === 'pre_riscaldo_scaduto') { headerIcon = '⚠️'; headerLabel = 'PRE-RISCALDO SCADUTO'; headerColor = 'text-danger' }
  else if (prio === 'pre_riscaldo')       { headerIcon = '🟡'; headerLabel = 'PRE-RISCALDO'; headerColor = 'text-warning' }
  else if (prio === 'in_preparazione')    { headerIcon = '🔄'; headerLabel = 'IN PREPARAZIONE'; headerColor = 'text-warning' }

  // Countdown pre_riscaldo (se applicabile, prendi il piu' urgente)
  let countdownSec = null
  if (prio === 'pre_riscaldo' || prio === 'pre_riscaldo_scaduto') {
    const seconds = items
      .map(it => secondiRimanentiPreRiscaldo(it))
      .filter(s => s != null)
    if (seconds.length > 0) countdownSec = Math.min(...seconds)
  }

  const aggr = useMemo(() => aggregaPerNome(items), [items])
  const sourceIcon = categoria === 'cucina' ? '🍳' : '🍺'

  // CTA: dipende dallo stato corrente
  // - in_attesa     -> NESSUN pulsante (mandata bloccata, attende sblocco cameriere)
  // - sbloccata     -> "Da preparare" (gold)            -> tap -> in_preparazione
  // - pre_riscaldo  -> "Da preparare" (gold, sfondo warning)
  // - in_preparazione -> "Metti in finestra" (success)  -> tap -> in_finestra
  let ctaLabel = null
  let ctaHandler = null
  let ctaCls = 'bg-gold text-bg'
  if (stato === 'sbloccata' || stato === 'pre_riscaldo') {
    ctaLabel = '📋 Da preparare'
    ctaHandler = onInPreparazione
    ctaCls = 'bg-gold text-bg'
  } else if (stato === 'in_preparazione') {
    ctaLabel = categoria === 'cucina' ? '🪟 Metti in finestra' : '🪟 Pronto al banco'
    ctaHandler = onInFinestra
    ctaCls = 'bg-success text-bg'
  }
  // in_attesa: nessuna CTA, mostriamo solo il label "IN ATTESA SBLOCCO".
  const showCta = !disabledByStorno && ctaLabel != null

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
    <div className={`relative rounded-card p-3 border-[1.5px] ${borderCls} ${bgCls} ${extraCls} shadow-sm`}>
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
            </div>
            <div className={`text-[11px] font-bold uppercase tracking-[0.4px] mt-[1px] ${headerColor}`}>
              {headerIcon} {headerLabel}
            </div>
          </div>
        </div>
        {countdownSec != null && (
          <span className={`pill tabular-nums text-[12px]
                            ${countdownSec < 0
                              ? 'bg-dangerSoft text-danger border border-danger'
                              : 'bg-surfaceElev text-textSoft border border-border'}`}>
            ⏱ {fmtCountdown(countdownSec)}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1.5 mb-2">
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

      {showCta && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try { await ctaHandler() } finally { setBusy(false) }
          }}
          className={`${ctaCls} w-full min-h-[50px] rounded-btn py-2 font-extrabold text-[15px]
                     tracking-[0.4px] shadow-[0_3px_0_#3F2A1F]
                     active:scale-95 transition-transform
                     disabled:opacity-50 disabled:active:scale-100`}
        >
          {busy ? 'Aggiornamento…' : ctaLabel}
        </button>
      )}
    </div>
  )
}

function MandataInFinestraBlock({ numero, items, categoria }) {
  const aggr = useMemo(() => aggregaPerNome(items), [items])
  return (
    <div className="relative rounded-card p-3 border-[1.5px] border-success bg-successSoft/30 shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-extrabold uppercase tracking-[1.4px] text-success">
          🪟 M{numero} · IN FINESTRA
        </div>
        <div className="text-[10.5px] font-semibold text-textSoft uppercase tracking-wider">
          attendi cameriere
        </div>
      </div>
      <p className="text-[13px] text-text break-words">
        {aggr.map(a => `${a.nome} ×${a.q}`).join(' · ')}
      </p>
    </div>
  )
}

// -------------------- VISTA AGGREGATA --------------------
//
// 3 sezioni per cucina (Da impiattare ora / Pre-riscaldo / In attesa).
// 3 sezioni per bar    (Da servire ora   / In preparazione / In attesa).
// Sempre escludi: in_finestra, consegnata, in_pausa.

function VistaAggregata({ orders, categoria }) {
  const sezioni = useMemo(() => calcolaSezioniAggregate(orders, categoria), [orders, categoria])

  const totale = sezioni.reduce((s, sec) => s + sec.tot, 0)
  if (totale === 0) {
    return (
      <div className="text-center py-12">
        <p className="font-display text-[24px] text-text mb-1">Nulla da preparare 🎉</p>
        <p className="text-textSoft text-[13px] font-semibold">Tutta la coda smaltita</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {sezioni.map(sec => (
        <AggregateSezione key={sec.key} sezione={sec} categoria={categoria} />
      ))}
    </div>
  )
}

function calcolaSezioniAggregate(orders, categoria) {
  // Stati target per sezione (cucina: pre_riscaldo + sbloccata + in_prep + in_attesa).
  // Bar non ha pre_riscaldo: solo sbloccata + in_prep + in_attesa.
  const isCucina = categoria === 'cucina'

  // Aggrega per nome_item dentro ciascuna sezione (mantiene la lista tavoli).
  const buckets = {
    urgente:      new Map(),
    preRiscaldo:  new Map(),
    inPrep:       new Map(),
    inAttesa:     new Map(),
  }

  for (const order of orders) {
    if (order.stato === 'stornato') continue
    const myItems = itemsDellaStazione(order.order_items, categoria)
    for (const it of myItems) {
      let bucket
      if (it.mandata_stato === 'sbloccata') bucket = buckets.urgente
      else if (isCucina && it.mandata_stato === 'pre_riscaldo') bucket = buckets.preRiscaldo
      else if (it.mandata_stato === 'in_preparazione') bucket = buckets.inPrep
      else if (it.mandata_stato === 'in_attesa') {
        // Bar M4 in_attesa = ancora bloccata, gia' esclusa da itemsDellaStazione.
        bucket = buckets.inAttesa
      } else continue

      const key = it.nome_item
      if (!bucket.has(key)) {
        bucket.set(key, {
          nome_item: it.nome_item,
          ordine: it.menu_items?.ordine ?? it.ordine ?? 99,
          byTavolo: new Map(),
          minPreRiscaldoAt: null,
        })
      }
      const entry = bucket.get(key)
      const cur = entry.byTavolo.get(order.numero_tavolo) || 0
      entry.byTavolo.set(order.numero_tavolo, cur + it.quantita)
      if (it.pre_riscaldo_at) {
        const t = new Date(it.pre_riscaldo_at).getTime()
        if (entry.minPreRiscaldoAt == null || t < entry.minPreRiscaldoAt) entry.minPreRiscaldoAt = t
      }
    }
  }

  const toItems = (map) => Array.from(map.values()).map(e => ({
    nome_item: e.nome_item,
    ordine: e.ordine,
    total_qty: Array.from(e.byTavolo.values()).reduce((s, q) => s + q, 0),
    byTavolo: Array.from(e.byTavolo.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([tavolo, qty]) => ({ tavolo, qty })),
    minPreRiscaldoAt: e.minPreRiscaldoAt,
  }))

  const sezioni = []
  const urgenteItems = toItems(buckets.urgente)
  sezioni.push({
    key: 'urgente',
    label: isCucina ? 'DA IMPIATTARE ORA' : 'DA SERVIRE ORA',
    icon: '🔴',
    tone: 'danger',
    tot: urgenteItems.reduce((s, it) => s + it.total_qty, 0),
    items: urgenteItems,
    grouped: true,
  })

  if (isCucina) {
    const prItems = toItems(buckets.preRiscaldo)
      .sort((a, b) => (a.minPreRiscaldoAt ?? 0) - (b.minPreRiscaldoAt ?? 0))
    sezioni.push({
      key: 'pre_riscaldo',
      label: 'PRE-RISCALDO',
      icon: '🟡',
      tone: 'warning',
      tot: prItems.reduce((s, it) => s + it.total_qty, 0),
      items: prItems,
      grouped: true,
    })
  }

  const inPrepItems = toItems(buckets.inPrep)
  sezioni.push({
    key: 'in_prep',
    label: 'IN PREPARAZIONE',
    icon: '🔄',
    tone: 'warning',
    tot: inPrepItems.reduce((s, it) => s + it.total_qty, 0),
    items: inPrepItems,
    grouped: true,
  })

  // "In attesa" mostriamo solo contatori per portata (cucina) o per categoria (bar)
  const inAttesaItems = toItems(buckets.inAttesa)
  sezioni.push({
    key: 'in_attesa',
    label: 'IN ATTESA',
    icon: '⬜',
    tone: 'textSoft',
    tot: inAttesaItems.reduce((s, it) => s + it.total_qty, 0),
    items: inAttesaItems,
    grouped: false, // mostra solo conteggi
  })

  return sezioni
}

function AggregateSezione({ sezione, categoria }) {
  if (sezione.tot === 0) return null

  const headerToneCls = {
    danger:   'bg-dangerSoft text-danger border-danger/40',
    warning:  'bg-warningSoft text-warning border-warning/40',
    success:  'bg-successSoft text-success border-success/40',
    textSoft: 'bg-[rgba(196,168,130,0.10)] text-textSoft border-borderSoft',
  }[sezione.tone] || 'bg-surfaceElev text-textSoft border-border'

  return (
    <section>
      <div className={`flex items-center justify-between rounded-card px-3 py-2 mb-3
                       border ${headerToneCls}
                       ${sezione.key === 'urgente' ? 'animate-pulseUrgent' : ''}`}>
        <div className="text-[12px] font-extrabold uppercase tracking-[1.4px]">
          {sezione.icon} {sezione.label}
        </div>
        <div className="text-[14px] font-extrabold tabular-nums">
          {sezione.tot} porzion{sezione.tot === 1 ? 'e' : 'i'}
        </div>
      </div>

      {sezione.grouped ? (
        // Dettaglio per piatto + tavoli coinvolti
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sezione.items
            .sort((a, b) => (a.ordine - b.ordine) || a.nome_item.localeCompare(b.nome_item))
            .map(p => (
              <PietanzaCard key={p.nome_item} pietanza={p}
                            urgent={sezione.key === 'urgente'}
                            scadutaCheck={sezione.key === 'pre_riscaldo'} />
            ))}
        </ul>
      ) : (
        // Solo conteggi per categoria (in attesa)
        <ContatoreCategorie items={sezione.items} categoria={categoria} />
      )}
    </section>
  )
}

function PietanzaCard({ pietanza, urgent, scadutaCheck }) {
  const scaduta = scadutaCheck && pietanza.minPreRiscaldoAt != null
    && Date.now() > pietanza.minPreRiscaldoAt
  const badgeCls = urgent || scaduta
    ? 'bg-danger text-bg animate-pulseDot'
    : 'bg-gold text-bg'

  return (
    <li className="bg-surface border border-borderSoft rounded-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-[18px] font-extrabold text-text flex-1 min-w-0 break-words">
          {pietanza.nome_item}
        </h3>
        <span className={`${badgeCls} font-extrabold px-3 py-1 rounded-phone tabular-nums
                          text-[13px] shrink-0 whitespace-nowrap shadow-cta`}>
          {urgent || scaduta ? '⚠️ ' : ''}{pietanza.total_qty}
        </span>
      </div>
      <p className="text-[12.5px] text-textSoft font-semibold break-words">
        {pietanza.byTavolo
          .sort((a, b) => a.tavolo - b.tavolo)
          .map(t => `Tav.${t.tavolo} ×${t.qty}`).join(' · ')}
      </p>
    </li>
  )
}

function ContatoreCategorie({ items, categoria }) {
  // Per cucina raggruppiamo per sottocategoria (antipasti/primi/secondi/contorni/dolci).
  // Per bar usiamo le fasce PORTATE_BAR.
  if (items.length === 0) return null

  let etichette = []
  if (categoria === 'cucina') {
    const map = new Map([
      ['Antipasti', 0], ['Primi', 0], ['Secondi', 0], ['Contorni', 0], ['Dolci', 0],
    ])
    for (const it of items) {
      const sotto = getSottocategoriaFromOrdine(it.ordine)
      const key = ({
        antipasto: 'Antipasti',
        primo:     'Primi',
        secondo:   'Secondi',
        contorno:  'Contorni',
        dolce:     'Dolci',
      })[sotto] || null
      if (key) map.set(key, (map.get(key) || 0) + it.total_qty)
    }
    etichette = Array.from(map.entries())
      .filter(([, q]) => q > 0)
      .map(([k, q]) => ({ label: k, qty: q }))
  } else {
    const map = new Map()
    for (const it of items) {
      const portata = PORTATE_BAR.find(p => p.test(it.ordine))?.label || 'Altro'
      map.set(portata, (map.get(portata) || 0) + it.total_qty)
    }
    etichette = Array.from(map.entries()).map(([k, q]) => ({ label: k, qty: q }))
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {etichette.map(e => (
        <li key={e.label}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-card
                       bg-surface border border-borderSoft shadow-sm">
          <span className="text-[12.5px] font-extrabold uppercase tracking-[0.6px] text-textSoft">
            {e.label}
          </span>
          <span className="text-[15px] font-extrabold tabular-nums text-text">{e.qty}</span>
        </li>
      ))}
    </ul>
  )
}
