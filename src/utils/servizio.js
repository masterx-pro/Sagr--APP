// Utility per la logica turni/servizio.
// Servizio "pranzo" prima delle 16:00, "cena" dalle 16:00 in poi.
// La data del servizio è la data locale del dispositivo (YYYY-MM-DD).

export function getServizioAttuale() {
  return new Date().getHours() < 16 ? 'pranzo' : 'cena'
}

export function getDataServizio() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function servizioLabel(s) {
  return s === 'pranzo' ? '🌞 PRANZO' : '🌙 CENA'
}

// Range UTC che copre l'intera giornata locale corrispondente a `dataLocale` (YYYY-MM-DD)
export function dataLocaleToUtcRange(dataLocale) {
  const startLocal = new Date(`${dataLocale}T00:00:00`)
  const endLocal = new Date(`${dataLocale}T00:00:00`)
  endLocal.setDate(endLocal.getDate() + 1)
  return { startUTC: startLocal.toISOString(), endUTC: endLocal.toISOString() }
}

// =============================================================
// PORTATE & TIMER MANDATE (v2)
// =============================================================

// Determina la portata logica di un item cucina in base al campo `ordine`
// del menu_item. Allineato al groupBy usato in MenuSelector/StationPage/AdminPage.
//   1-9   Antipasto
//   10-19 Primo
//   20-29 Secondo
//   30-39 Dolce
// Voci bar o non classificate ritornano null.
export function getPortataFromOrdine(ordine) {
  const o = ordine ?? 0
  if (o >= 1  && o <= 9)  return 'antipasto'
  if (o >= 10 && o <= 19) return 'primo'
  if (o >= 20 && o <= 29) return 'secondo'
  if (o >= 30 && o <= 39) return 'dolce'
  return null
}

// Items bar con ordine >= 40 (caffè/amari) sono di default mandata 2:
// vengono "sbloccati" dal cameriere a fine pasto.
export function isBarMandata2(item) {
  if (!item || item.categoria !== 'bar') return false
  const ordine = item.ordine ?? item.menu_items?.ordine ?? 0
  return ordine >= 40
}

// Helper interno: legge un valore dalla mappa impostazioni e lo converte
// in numero. Se mancante o non valido ritorna `fallback`.
function leggiMin(impostazioni, key, fallback) {
  const v = impostazioni?.[key]
  const n = v == null ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Tempo di consumo (minuti) per una portata, letto da impostazioni.
// Portata sconosciuta → fallback al tempo del primo (valore medio).
export function getTempoConsumoPortata(portata, impostazioni) {
  switch (portata) {
    case 'antipasto': return leggiMin(impostazioni, 'tempo_consumo_antipasto_min', 15)
    case 'primo':     return leggiMin(impostazioni, 'tempo_consumo_primo_min',     20)
    case 'secondo':   return leggiMin(impostazioni, 'tempo_consumo_secondo_min',   25)
    case 'dolce':     return leggiMin(impostazioni, 'tempo_consumo_dolce_min',     10)
    default:          return leggiMin(impostazioni, 'tempo_consumo_primo_min',     20)
  }
}

// Timer (minuti) prima che la mandata SUCCESSIVA diventi urgente.
// Parte quando la cucina marca "pronta" la mandata corrente.
//   timer = tempo_consegna + tempo_consumo_portata_corrente + tempo_preparazione_cucina
export function getTimerMandata(portataCorrente, impostazioni) {
  const consegna     = leggiMin(impostazioni, 'tempo_consegna_min',             5)
  const preparazione = leggiMin(impostazioni, 'tempo_preparazione_cucina_min', 15)
  const consumo      = getTempoConsumoPortata(portataCorrente, impostazioni)
  return consegna + consumo + preparazione
}
