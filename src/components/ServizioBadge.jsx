import { getServizioAttuale, servizioLabel } from '../utils/servizio.js'

/**
 * Badge "🌞 PRANZO" / "🌙 CENA" da mostrare in header.
 * Calcolato in base all'orario corrente del dispositivo.
 */
export default function ServizioBadge({ className = '' }) {
  return (
    <span
      className={`text-xs font-bold px-2 py-1 rounded-full bg-white/20
                  whitespace-nowrap ${className}`}
    >
      {servizioLabel(getServizioAttuale())}
    </span>
  )
}
