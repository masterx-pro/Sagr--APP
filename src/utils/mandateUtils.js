// Utility per la logica delle mandate sugli order_items.
// Pure functions, nessuna dipendenza da Supabase: testabili in isolamento.

import {
  getPortataFromOrdine,
  getTempoConsumoPortata,
  getTimerMandata,
  getTimerMandateMinuti,
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

// Stato display di una mandata (gruppo di items).
// Regole di priorita' (dall'alto verso il basso):
//   - almeno un item in_pausa            -> 'in_pausa'
//   - tutti gli item consegnati          -> 'consegnata'
//   - tutti pronti o consegnati          -> 'pronta'
//   - almeno uno in_preparazione         -> 'in_preparazione'
//   - altrimenti                         -> 'in_attesa'
export function getStatoMandataDisplay(mandataItems) {
  const items = mandataItems || []
  if (items.length === 0) return 'in_attesa'
  if (items.some(i => i.mandata_stato === 'in_pausa')) return 'in_pausa'
  if (items.every(i => i.mandata_stato === 'consegnata')) return 'consegnata'
  if (items.every(i => i.mandata_stato === 'pronta' || i.mandata_stato === 'consegnata')) return 'pronta'
  if (items.some(i => i.mandata_stato === 'in_preparazione')) return 'in_preparazione'
  return 'in_attesa'
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
    const portata = getPortataFromOrdine(ordine)
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
