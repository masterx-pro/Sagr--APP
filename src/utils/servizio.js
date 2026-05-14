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
