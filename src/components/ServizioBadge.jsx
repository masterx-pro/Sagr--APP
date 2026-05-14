import { useEffect, useState } from 'react'
import { getFasciaOrariaAttuale, fasciaLabel } from '../utils/servizio.js'

const COLORI_FASCIA = {
  colazione: 'bg-orange-300/30 text-orange-100 border border-orange-400/40',
  pranzo:    'bg-yellow-500/30 text-yellow-50 border border-yellow-400/40',
  aperitivo: 'bg-pink-500/30 text-pink-50 border border-pink-400/40',
  cena:      'bg-blue-700/40 text-blue-50 border border-blue-400/40',
}

const PAUSA_CLS = 'bg-gray-700/40 text-gray-300 border border-gray-500/40'

/**
 * Badge fascia oraria.
 *   - Accetta `impostazioni` come prop (mappa {chiave: valore} dalle
 *     righe di tabella `impostazioni`). Se mancante, usa i default
 *     hardcoded in servizio.js.
 *   - Si aggiorna da solo ogni minuto per ricalcolare la fascia
 *     senza richiedere un re-render del parent.
 *   - Se nessuna fascia e' attiva nell'ora corrente -> "⏸️ PAUSA".
 */
export default function ServizioBadge({ impostazioni, className = '' }) {
  // Tick interno per aggiornare il badge al passaggio di fascia
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const fascia = getFasciaOrariaAttuale(impostazioni)
  const label = fasciaLabel(fascia)
  const cls = fascia ? COLORI_FASCIA[fascia] : PAUSA_CLS

  return (
    <span
      className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap
                  ${cls} ${className}`}
    >
      {label}
    </span>
  )
}
