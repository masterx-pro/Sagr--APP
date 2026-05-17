import { useEffect, useState } from 'react'
import { getFasciaOrariaAttuale } from '../utils/servizio.js'

// Token tabella SERVIZI (vedi README handoff)
const SERVIZI = {
  colazione: { label: 'COLAZIONE', icon: '🌅', bg: 'rgba(240,168,32,0.18)',  fg: '#F0A820', ring: 'rgba(240,168,32,0.40)' },
  pranzo:    { label: 'PRANZO',    icon: '🌞', bg: 'rgba(212,160,67,0.18)',  fg: '#D4A043', ring: 'rgba(212,160,67,0.40)' },
  aperitivo: { label: 'APERITIVO', icon: '🥂', bg: 'rgba(200,120,170,0.18)', fg: '#E89AC4', ring: 'rgba(200,120,170,0.40)' },
  cena:      { label: 'CENA',      icon: '🌙', bg: 'rgba(100,140,210,0.18)', fg: '#8FB4E8', ring: 'rgba(100,140,210,0.40)' },
  pausa:     { label: 'PAUSA',     icon: '⏸',  bg: 'rgba(196,168,130,0.14)', fg: '#C4A882', ring: 'rgba(196,168,130,0.30)' },
}

/**
 * Badge fascia oraria attiva.
 *  - `impostazioni` opzionale: deriva fascia da getFasciaOrariaAttuale.
 *  - `servizio` opzionale: forza una fascia specifica (override).
 *  - `size`: 'sm' | 'lg'
 */
export default function ServizioBadge({ impostazioni, servizio, size = 'sm', className = '' }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const fascia = servizio || getFasciaOrariaAttuale(impostazioni) || 'pausa'
  const s = SERVIZI[fascia] || SERVIZI.pausa
  const lg = size === 'lg'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-phone font-extrabold uppercase
                  ${lg ? 'text-[13px] py-[7px] pl-[10px] pr-3' : 'text-[11px] py-1 pl-[7px] pr-[9px]'}
                  tracking-[0.6px] ${className}`}
      style={{
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.ring}`,
      }}
    >
      <span className={lg ? 'text-[15px]' : 'text-[13px]'}>{s.icon}</span>
      {s.label}
    </span>
  )
}
