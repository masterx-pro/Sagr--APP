// Utility per la logica servizio (pranzo/cena), portate e mandate.
// Servizio "pranzo" prima delle 16:00, "cena" dalle 16:00 in poi.

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

export function dataLocaleToUtcRange(dataLocale) {
  const startLocal = new Date(`${dataLocale}T00:00:00`)
  const endLocal = new Date(`${dataLocale}T00:00:00`)
  endLocal.setDate(endLocal.getDate() + 1)
  return { startUTC: startLocal.toISOString(), endUTC: endLocal.toISOString() }
}

// =============================================================
// PORTATE & SOTTOCATEGORIE (v3)
// =============================================================
//
// Mapping autoritativo:
//   cucina sottocategoria | ordine atteso | mandata di default
//   ---------------------+---------------+--------------------
//   antipasto            | 1-9           | M1
//   primo                | 10-19         | M2
//   secondo              | 20-29         | M3
//   dolce                | 30-39         | M4
//   contorno             | 40-49         | M3
//   bar (ordine < 40)    | qualunque     | M1
//   bar (ordine >= 40)   | qualunque     | M4  (caffe' / amari)

const SOTTOCATEGORIE_CUCINA = ['antipasto', 'primo', 'secondo', 'contorno', 'dolce']

// Determina la sottocategoria di un item cucina:
//   - se il campo `sottocategoria` e' presente, lo usa direttamente
//   - altrimenti fallback sulla fascia `ordine` (compat v2 / dati legacy)
export function getSottocategoriaCucina(item) {
  if (!item) return null
  if (item.categoria !== 'cucina') return null
  if (item.sottocategoria && SOTTOCATEGORIE_CUCINA.includes(item.sottocategoria)) {
    return item.sottocategoria
  }
  return getSottocategoriaFromOrdine(item.ordine ?? item.menu_items?.ordine ?? 0)
}

export function getSottocategoriaFromOrdine(ordine) {
  const o = ordine ?? 0
  if (o >= 1  && o <= 9)  return 'antipasto'
  if (o >= 10 && o <= 19) return 'primo'
  if (o >= 20 && o <= 29) return 'secondo'
  if (o >= 30 && o <= 39) return 'dolce'
  if (o >= 40 && o <= 49) return 'contorno'
  return null
}

// Alias storico: la "portata" della cucina e' la sottocategoria.
// Mantenuta per retro-compatibilita' con il timer formula v2.
export function getPortataFromOrdine(ordine) {
  return getSottocategoriaFromOrdine(ordine)
}

// Items bar con ordine >= 40 (caffe' / amari) sono di default mandata 4:
// vengono "sbloccati" dal cameriere a fine pasto.
export function isBarMandata4(item) {
  if (!item || item.categoria !== 'bar') return false
  const ordine = item.ordine ?? item.menu_items?.ordine ?? 0
  return ordine >= 40
}

// Alias retro-compatibile (era isBarMandata2 in v2). Da rimuovere appena
// tutti i callers passano alla nuova denominazione.
export const isBarMandata2 = isBarMandata4

// Mandata di default per un menu_item: 1-4.
//   - cucina: derivata dalla sottocategoria
//   - bar:    1 di default, 4 se caffe' / amari
export function getMandataPerItem(menuItem) {
  if (!menuItem) return 1
  if (menuItem.categoria === 'bar') return isBarMandata4(menuItem) ? 4 : 1
  if (menuItem.categoria === 'cucina') {
    const sotto = getSottocategoriaCucina(menuItem)
    switch (sotto) {
      case 'antipasto': return 1
      case 'primo':     return 2
      case 'secondo':   return 3
      case 'contorno':  return 3
      case 'dolce':     return 4
      default:          return 1
    }
  }
  return 1
}

// Range di `ordine` per una sottocategoria (usato dal form admin
// per assegnare automaticamente l'ordine di un nuovo piatto).
export function rangeOrdinePerSottocategoria(sotto) {
  switch (sotto) {
    case 'antipasto': return [1, 9]
    case 'primo':     return [10, 19]
    case 'secondo':   return [20, 29]
    case 'dolce':     return [30, 39]
    case 'contorno':  return [40, 49]
    default:          return null
  }
}

// =============================================================
// TIMER MANDATE (v3)
// =============================================================

function leggiMin(impostazioni, key, fallback) {
  const v = impostazioni?.[key]
  const n = v == null ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Tempo di consumo (minuti) per una portata, letto da impostazioni.
// Contorno usa il tempo del secondo (sono nella stessa mandata).
export function getTempoConsumoPortata(portata, impostazioni) {
  switch (portata) {
    case 'antipasto': return leggiMin(impostazioni, 'tempo_consumo_antipasto_min', 15)
    case 'primo':     return leggiMin(impostazioni, 'tempo_consumo_primo_min',     20)
    case 'secondo':   return leggiMin(impostazioni, 'tempo_consumo_secondo_min',   25)
    case 'contorno':  return leggiMin(impostazioni, 'tempo_consumo_secondo_min',   25)
    case 'dolce':     return leggiMin(impostazioni, 'tempo_consumo_dolce_min',     10)
    default:          return leggiMin(impostazioni, 'tempo_consumo_primo_min',     20)
  }
}

// Timer "vecchio modello" (v2): consegna + consumo + preparazione.
// Mantenuto per retro-compatibilita' con calcolaTimerScaduto in mandateUtils.
export function getTimerMandata(portataCorrente, impostazioni) {
  const consegna     = leggiMin(impostazioni, 'tempo_consegna_min',             5)
  const preparazione = leggiMin(impostazioni, 'tempo_preparazione_cucina_min', 15)
  const consumo      = getTempoConsumoPortata(portataCorrente, impostazioni)
  return consegna + consumo + preparazione
}

// Timer v3 semplificato: un singolo valore in minuti tra una mandata
// marcata 'pronta' e l'urgenza della successiva.
export function getTimerMandateMinuti(impostazioni) {
  return leggiMin(impostazioni, 'tempo_timer_mandate_min', 10)
}
