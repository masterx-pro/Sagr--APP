// Utility per la logica delle mandate sugli order_items.
// Pure functions, nessuna dipendenza da Supabase: testabili in isolamento.

import {
  getSottocategoriaFromOrdine,
  getTempoConsumoPortata,
  getTimerMandata,
  getTimerMandateMinuti,
  getTimerPreRiscaldo,
} from './servizio.js'

// -------------------------------------------------------------
// Raggruppamento
// -------------------------------------------------------------

// Raggruppa order_items per numero di mandata.
// Ritorna un oggetto: { 1: [...items], 2: [...items], 3: [...items] }.
// I numeri non utilizzati semplicemente non compaiono come chiave.
export function groupByMandata(orderItems) {
  const groups = {}
  for (const it of orderItems || []) {
    const m = it.mandata ?? 1
    if (!groups[m]) groups[m] = []
    groups[m].push(it)
  }
  return groups
}

// Lista ordinata dei numeri di mandata presenti, dal più basso al più alto.
export function getNumeriMandata(orderItems) {
  const groups = groupByMandata(orderItems)
  return Object.keys(groups).map(Number).sort((a, b) => a - b)
}

// -------------------------------------------------------------
// Stato mandata
// -------------------------------------------------------------

// Stato display di una mandata (gruppo di items), versione v5.
// Stati possibili (sui singoli items):
//   in_attesa | pre_riscaldo | sbloccata | in_preparazione | in_finestra |
//   consegnata | in_pausa
//
// Regole di priorita' display (dall'alto verso il basso):
//   - almeno un item in_pausa            -> 'in_pausa'
//   - tutti gli item consegnati          -> 'consegnata'
//   - tutti in finestra o consegnati     -> 'in_finestra'
//   - almeno uno in_preparazione         -> 'in_preparazione'
//   - almeno uno sbloccata               -> 'sbloccata'  (urgente)
//   - almeno uno pre_riscaldo            -> 'pre_riscaldo'
//   - altrimenti                         -> 'in_attesa'
export function getStatoMandataDisplay(mandataItems) {
  const items = mandataItems || []
  if (items.length === 0) return 'in_attesa'
  if (items.some(i => i.mandata_stato === 'in_pausa')) return 'in_pausa'
  if (items.every(i => i.mandata_stato === 'consegnata')) return 'consegnata'
  if (items.every(i => i.mandata_stato === 'in_finestra' || i.mandata_stato === 'consegnata')) return 'in_finestra'
  if (items.some(i => i.mandata_stato === 'in_preparazione')) return 'in_preparazione'
  if (items.some(i => i.mandata_stato === 'sbloccata')) return 'sbloccata'
  if (items.some(i => i.mandata_stato === 'pre_riscaldo')) return 'pre_riscaldo'
  return 'in_attesa'
}

// Tabella di lookup display per i nuovi stati v5. Le `color` sono nomi
// dei token Tailwind (text-<color>, bg-<color>Soft, border-<color>); la
// UI le compone alla bisogna. `priority` = ordinamento decrescente
// di urgenza (piu' alto = piu' urgente in cima alla lista cucina/bar).
export const STATO_MANDATA_META = {
  in_attesa:       { label: 'In attesa',       color: 'textMute', icon: '⬜', priority: 1 },
  pre_riscaldo:    { label: 'Pre-riscaldo',    color: 'warning',  icon: '🟡', priority: 3 },
  sbloccata:       { label: 'Urgente',         color: 'danger',   icon: '🔴', priority: 5 },
  in_preparazione: { label: 'In preparazione', color: 'warning',  icon: '🔄', priority: 4 },
  in_finestra:     { label: 'In finestra',     color: 'success',  icon: '🪟', priority: 6 },
  consegnata:      { label: 'Consegnata',      color: 'textMute', icon: '✅', priority: 0 },
  in_pausa:        { label: 'In pausa',        color: 'danger',   icon: '⏸',  priority: 7 },
}

export function metaStatoMandata(stato) {
  return STATO_MANDATA_META[stato] || STATO_MANDATA_META.in_attesa
}

// Priorita' di una singola mandata (gruppo items) per ordinamento KDS.
// Restituisce una delle chiavi sotto, con `urgente` la piu' alta:
//   'in_pausa'              → ordine stornato
//   'urgente'               → almeno 1 item 'sbloccata'
//   'pre_riscaldo_scaduto'  → tutti in 'pre_riscaldo' e timer scaduto
//   'pre_riscaldo'          → almeno 1 in 'pre_riscaldo' (non scaduto)
//   'in_preparazione'       → almeno 1 in 'in_preparazione'
//   'in_finestra'           → tutti in 'in_finestra'/'consegnata'
//   'consegnata'            → tutti consegnati
//   'in_attesa'             → resto
export function getPrioritaMandata(mandataItems) {
  const items = mandataItems || []
  if (items.length === 0) return 'in_attesa'
  if (items.some(i => i.mandata_stato === 'in_pausa')) return 'in_pausa'
  if (items.some(i => i.mandata_stato === 'sbloccata')) return 'urgente'

  const tuttiPreRiscaldo = items.every(i => i.mandata_stato === 'pre_riscaldo')
  const algunPreRiscaldo = items.some(i => i.mandata_stato === 'pre_riscaldo')
  if (tuttiPreRiscaldo) {
    const now = Date.now()
    const scaduti = items.every(i => {
      if (!i.pre_riscaldo_at) return true
      const t = new Date(i.pre_riscaldo_at).getTime()
      return Number.isFinite(t) && now > t
    })
    return scaduti ? 'pre_riscaldo_scaduto' : 'pre_riscaldo'
  }

  if (items.some(i => i.mandata_stato === 'in_preparazione')) return 'in_preparazione'
  if (items.every(i => i.mandata_stato === 'consegnata')) return 'consegnata'
  if (items.every(i => i.mandata_stato === 'in_finestra' || i.mandata_stato === 'consegnata')) return 'in_finestra'
  if (algunPreRiscaldo) {
    // mix di in_attesa + pre_riscaldo: gestiscilo come pre_riscaldo
    return 'pre_riscaldo'
  }
  return 'in_attesa'
}

// Peso numerico per ordinare card di tavoli/mandate (piu' alto = piu' urgente).
// L'ordine usato in cucina/bar: urgente > scaduto > pre_riscaldo > in_prep > in_attesa > in_finestra > consegnata > in_pausa
export const PRIORITA_PESO = {
  urgente:              60,
  pre_riscaldo_scaduto: 55,
  pre_riscaldo:         50,
  in_preparazione:      40,
  in_attesa:            30,
  in_finestra:          20,
  consegnata:           10,
  in_pausa:              5,
}
export function pesoPriorita(prio) {
  return PRIORITA_PESO[prio] ?? 0
}

// Restituisce solo gli items in 'pre_riscaldo' che hanno il timer scaduto
// (now > pre_riscaldo_at). Utility pure, niente Supabase.
export function checkPreRiscaldoScaduto(orderItems) {
  const now = Date.now()
  return (orderItems || []).filter(it => {
    if (it.mandata_stato !== 'pre_riscaldo') return false
    if (!it.pre_riscaldo_at) return false
    const t = new Date(it.pre_riscaldo_at).getTime()
    return Number.isFinite(t) && now > t
  })
}

// Secondi rimanenti al pre_riscaldo_at (puo' essere negativo se scaduto).
// null se l'item non e' in pre_riscaldo o manca il timestamp.
export function secondiRimanentiPreRiscaldo(item) {
  if (!item || item.mandata_stato !== 'pre_riscaldo') return null
  if (!item.pre_riscaldo_at) return null
  const t = new Date(item.pre_riscaldo_at).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((t - Date.now()) / 1000)
}

// Numero della mandata "attiva" = la piu' bassa che contiene ancora
// item NON consegnati e NON in pausa. Serve a sapere su cosa stanno
// lavorando cucina/bar in questo momento.
// Se tutto e' consegnato o in pausa -> null.
export function getMandataAttiva(orderItems) {
  const groups = groupByMandata(orderItems)
  const numeri = Object.keys(groups).map(Number).sort((a, b) => a - b)
  for (const n of numeri) {
    const items = groups[n]
    const haAttivi = items.some(i =>
      i.mandata_stato !== 'consegnata' && i.mandata_stato !== 'in_pausa'
    )
    if (haAttivi) return n
  }
  return null
}

// -------------------------------------------------------------
// Timer mandata
// -------------------------------------------------------------

// Portata "dominante" di una mandata = quella con il tempo di consumo
// piu' lungo tra le portate cucina presenti. E' la portata che detta
// quanto tempo aspettare prima che la mandata successiva diventi urgente.
// Se la mandata non contiene voci cucina classificabili, ritorna null.
export function getPortataDominante(mandataItems, impostazioni) {
  const items = (mandataItems || []).filter(i => i.categoria === 'cucina')
  let best = null
  let bestTempo = -Infinity
  for (const it of items) {
    // Supporta sia il caso flat (it.ordine) sia il join (it.menu_items.ordine)
    const ordine = it.ordine ?? it.menu_items?.ordine ?? 0
    const portata = getSottocategoriaFromOrdine(ordine)
    if (!portata) continue
    const t = getTempoConsumoPortata(portata, impostazioni)
    if (t > bestTempo) {
      best = portata
      bestTempo = t
    }
  }
  return best
}

// Indica se il timer per la mandata successiva e' scaduto.
//   mandataProntaAt: timestamptz (ISO string o Date) — quando la
//     cucina ha cliccato "Pronta" sulla mandata corrente.
//   portataCorrente: 'antipasto'|'primo'|'secondo'|'dolce'
//   impostazioni:    mappa { chiave: valore } letta dalla tabella impostazioni
// Se mandataProntaAt e' assente o invalido -> false (timer non partito).
export function calcolaTimerScaduto(mandataProntaAt, portataCorrente, impostazioni) {
  if (!mandataProntaAt) return false
  const t0 = new Date(mandataProntaAt).getTime()
  if (!Number.isFinite(t0)) return false
  const minutiSoglia = getTimerMandata(portataCorrente, impostazioni)
  const elapsedMin = (Date.now() - t0) / 60_000
  return elapsedMin >= minutiSoglia
}

// Minuti rimanenti prima della scadenza timer (puo' essere negativo).
// Utile per mostrare un countdown in UI.
export function getMinutiRimanenti(mandataProntaAt, portataCorrente, impostazioni) {
  if (!mandataProntaAt) return null
  const t0 = new Date(mandataProntaAt).getTime()
  if (!Number.isFinite(t0)) return null
  const minutiSoglia = getTimerMandata(portataCorrente, impostazioni)
  const elapsedMin = (Date.now() - t0) / 60_000
  return Math.round(minutiSoglia - elapsedMin)
}

// -------------------------------------------------------------
// Timer v3: singolo intervallo configurabile tra mandate
// -------------------------------------------------------------
//
// Quando la cucina marca "pronta" una mandata, parte un timer
// (default 10 min, configurabile in admin). Allo scadere, la
// mandata successiva diventa "urgente" in cucina/bar.

// Restituisce il timestamp "mandata_pronta_at" piu' recente tra i
// gli items di una mandata. null se la mandata non e' ancora pronta.
export function getMandataProntaAt(mandataItems) {
  const t = (mandataItems || [])
    .map(i => i.mandata_pronta_at)
    .filter(Boolean)
    .map(s => new Date(s).getTime())
    .filter(n => Number.isFinite(n))
  if (t.length === 0) return null
  return new Date(Math.max(...t)).toISOString()
}

// True se sono passati >= tempo_timer_mandate_min minuti dal
// "mandata_pronta_at" della mandata precedente.
export function timerMandataScaduto(mandataPrecProntaAt, impostazioni) {
  if (!mandataPrecProntaAt) return false
  const t0 = new Date(mandataPrecProntaAt).getTime()
  if (!Number.isFinite(t0)) return false
  const soglia = getTimerMandateMinuti(impostazioni)
  const elapsedMin = (Date.now() - t0) / 60_000
  return elapsedMin >= soglia
}

// Secondi rimanenti al via della mandata successiva (puo' essere negativo).
// Utile per countdown live tipo "⏱ 8:32 al via".
export function secondiRimanentiTimerMandata(mandataPrecProntaAt, impostazioni) {
  if (!mandataPrecProntaAt) return null
  const t0 = new Date(mandataPrecProntaAt).getTime()
  if (!Number.isFinite(t0)) return null
  const sogliaMs = getTimerMandateMinuti(impostazioni) * 60_000
  return Math.floor((t0 + sogliaMs - Date.now()) / 1000)
}

// Format "MM:SS" da un valore in secondi (gestisce negativi -> 0:00).
export function formatCountdownSec(sec) {
  const s = Math.max(0, sec | 0)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}
