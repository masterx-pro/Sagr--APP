import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '../../supabaseClient.js'
import { useOrders } from '../../hooks/useOrders.js'
import { useImpostazioni } from '../../context/ImpostazioniContext.jsx'
import {
  getServizioAttuale,
  getTimerPreRiscaldo,
} from '../../utils/servizio.js'
import {
  groupByMandata,
  getStatoMandataDisplay,
  getPortataDominante,
  secondiRimanentiPreRiscaldo,
} from '../../utils/mandateUtils.js'
import KDSLayout from './KDSLayout.jsx'

/**
 * StationPageKDS — pagina KDS v2 (nuovo design 3-colonne landscape).
 *
 * Wire Supabase analogo a StationPage.jsx (legacy), ma renderizza con
 * KDSLayout + KDSCard. Una card per ogni (order, mandata) attiva.
 *
 * Mapping stati:
 *   mandata_stato (display) → colonna KDS
 *     sbloccata       → DA FARE
 *     pre_riscaldo    → DA FARE
 *     in_preparazione → IN CORSO
 *     in_finestra     → IN FINESTRA
 *     in_attesa       → nascosta (la cucina non la vede)
 *     consegnata      → nascosta (fuori dal KDS)
 *     in_pausa        → nascosta + contatore "stornati" nel header
 *
 * RUSH: il campo `rush` non esiste ancora a DB. Tenuto come stato
 * client-side (per cardId) in `rushSet`. Quando la migration aggiunge
 * `order_items.rush`, sostituire `onRush` con un UPDATE Supabase.
 */
const TICK_MS = 15_000
const POLL_PRE_RISCALDO_MS = 30_000

export default function StationPageKDS({ user, onLogout, categoria, role, titolo }) {
  const [orders, setOrders] = useState([])
  const { impostazioni } = useImpostazioni()
  const { markMandataInPreparazione, marcaInFinestra } = useOrders()
  const [refreshTick, setRefreshTick] = useState(0)
  const [servizioCorrente, setServizioCorrente] = useState(() => getServizioAttuale())
  const [rushSet, setRushSet] = useState(() => new Set())   // client-only

  // ── FETCH ordini attivi del servizio ──────────────────────────────
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, numero_tavolo, n_persone, nome_cliente, created_at, note, servizio, stato, tipo_pagamento, order_items(*, menu_items(ordine))')
      .in('stato', ['confermato', 'stornato'])
      .eq('servizio', servizioCorrente)
      .order('created_at', { ascending: true })
    if (error) { console.error(error); return }
    const filtrati = (data || []).filter(o =>
      itemsDellaStazione(o.order_items, categoria).length > 0
    )
    setOrders(filtrati)
  }, [categoria, servizioCorrente])

  useEffect(() => { load() }, [load, refreshTick])

  // Servizio (pranzo/cena) — segue impostazioni come la pagina legacy.
  useEffect(() => {
    const nuovo = getServizioAttuale(impostazioni)
    if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
  }, [impostazioni, servizioCorrente])
  useEffect(() => {
    const i = setInterval(() => {
      const nuovo = getServizioAttuale(impostazioni)
      if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
    }, 60_000)
    return () => clearInterval(i)
  }, [servizioCorrente, impostazioni])

  // Realtime: ogni mutazione order_items/orders del servizio → refetch.
  useEffect(() => {
    const channel = supabase
      .channel(`kds-${categoria}-${servizioCorrente}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_items' },
        () => setRefreshTick(t => t + 1))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `servizio=eq.${servizioCorrente}` },
        () => setRefreshTick(t => t + 1))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [categoria, servizioCorrente])

  // Tick locale per il timer del card (mantiene aggiornati i countdown).
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // POLLING PRE-RISCALDO (solo cucina) — identico a StationPage legacy.
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
            const prevFinestraAt = Math.max(...prevItems
              .map(it => new Date(it.in_finestra_at || 0).getTime())
              .filter(t => Number.isFinite(t) && t > 0))
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
              if (it.mandata_stato === 'in_attesa') idsDaPromuovere.push(it.id)
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
            .eq('mandata_stato', 'in_attesa')
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

  // ── Trasformazione orders → kdsOrders (una card per mandata) ────
  const kdsOrders = useMemo(
    () => buildKdsOrders(orders, categoria, rushSet),
    [orders, categoria, rushSet]
  )

  const stornatoCount = orders.filter(o => o.stato === 'stornato').length

  // ── Azioni ──────────────────────────────────────────────────────
  const onAdvance = useCallback(async (card) => {
    try {
      if (card.stato === 'sbloccata' || card.stato === 'pre_riscaldo') {
        await markMandataInPreparazione(card.orderId, card.mandataNum, categoria)
      } else if (card.stato === 'in_preparazione') {
        await marcaInFinestra(card.orderId, card.mandataNum, categoria)
      }
      // refetch immediato — la realtime farà il resto in background
      setRefreshTick(t => t + 1)
    } catch (e) {
      console.error(e)
      alert('Errore: ' + (e.message || e))
    }
  }, [categoria, markMandataInPreparazione, marcaInFinestra])

  const onRush = useCallback((card) => {
    setRushSet(prev => {
      const n = new Set(prev)
      if (n.has(card.id)) n.delete(card.id); else n.add(card.id)
      return n
    })
  }, [])

  return (
    <KDSLayout
      role={role || categoria}
      servizio={servizioCorrente}
      subtitle={`${user?.nome || ''} · ${kdsOrders.length} mandat${kdsOrders.length === 1 ? 'a' : 'e'} attiv${kdsOrders.length === 1 ? 'a' : 'e'}`}
      topBar={stornatoCount > 0 ? (
        <span className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-full
                         bg-dangerSoft border border-danger/40 text-danger
                         font-extrabold text-[12px] uppercase tracking-[1.4px]
                         animate-blink">
          <AlertTriangle size={14} strokeWidth={2.6} />
          {stornatoCount} stornat{stornatoCount === 1 ? 'o' : 'i'}
        </span>
      ) : null}
      orders={kdsOrders}
      onAdvance={onAdvance}
      onRush={onRush}
      onLogout={onLogout}
    />
  )
}

/* ────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────── */

// Stesso filtro di StationPage legacy.
function itemsDellaStazione(orderItems, categoria) {
  const items = orderItems || []
  if (categoria === 'cucina') {
    return items.filter(i => i.categoria === 'cucina' && i.mandata !== 4)
  }
  return items.filter(i => {
    if (i.categoria !== 'bar') return false
    const m4Bloccata = i.mandata === 4 && i.mandata_stato === 'in_attesa'
    return !m4Bloccata
  })
}

// Mappa display-stato → stato KDS (null = card non visibile).
function mapStato(display) {
  switch (display) {
    case 'sbloccata':       return 'sbloccata'
    case 'pre_riscaldo':    return 'pre_riscaldo'
    case 'in_preparazione': return 'in_preparazione'
    case 'in_finestra':     return 'in_finestra'
    default:                return null
  }
}

// Aggrega items della mandata per nome_item, sommando le quantità e
// raccogliendo le note in badge.
function aggregaItems(items) {
  const map = new Map()
  for (const it of items) {
    const cur = map.get(it.nome_item) || { nome: it.nome_item, q: 0, noteRaw: [] }
    cur.q += it.quantita
    if (it.note && typeof it.note === 'string') cur.noteRaw.push(it.note)
    map.set(it.nome_item, cur)
  }
  return Array.from(map.values()).map(v => ({
    nome: v.nome,
    q: v.q,
    note: v.noteRaw.length > 0
      ? [{ icon: '📝', label: v.noteRaw.join(' · '), color: '#F0A820' }]
      : null,
  }))
}

function buildKdsOrders(orders, categoria, rushSet) {
  const out = []
  for (const order of orders) {
    // stornato: skip (mostriamo solo il counter nel header)
    if (order.stato === 'stornato') continue

    const myItems = itemsDellaStazione(order.order_items, categoria)
    if (myItems.length === 0) continue

    const groups = groupByMandata(myItems)
    const numeri = Object.keys(groups).map(Number).sort((a, b) => a - b)

    for (const n of numeri) {
      const mandataItems = groups[n]
      const display = getStatoMandataDisplay(mandataItems)
      const stato = mapStato(display)
      if (!stato) continue

      const cardId = `${order.id}-M${n}`

      // Timer base: created_at dell'ordine (allineato a StationPage legacy).
      // Per pre_riscaldo, il countdown specifico è dentro mandataItems —
      // usiamo il created_at come timer "anzianità" e basta.
      const createdAt = new Date(order.created_at).getTime()

      out.push({
        id: cardId,
        orderId: order.id,
        mandataNum: n,
        mandataLabel: `M${n}`,
        tavolo: order.numero_tavolo,
        cliente: order.nome_cliente || `Tav. ${order.numero_tavolo}`,
        persone: order.n_persone,
        createdAt,
        stato,
        rush: rushSet.has(cardId),
        items: aggregaItems(mandataItems),
      })
    }
  }
  return out
}

// Esportato per coerenza con l'eventuale uso futuro (countdown specifico
// per pre_riscaldo nella card).
export { secondiRimanentiPreRiscaldo }
