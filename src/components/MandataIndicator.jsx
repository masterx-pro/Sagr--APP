/**
 * MandataIndicator v5 — micro-pill per riga indicators in OrderCard.
 *  - source: 'cucina' | 'bar'  → icon 🍳 / 🍺
 *  - mandata: numero mandata (1-4)
 *  - stato: 'in_attesa' | 'pre_riscaldo' | 'sbloccata' | 'in_preparazione'
 *           | 'in_finestra' | 'consegnata' | 'bloccata' (alias legacy)
 *           | 'in_pausa' (storno)
 */

const STATE_STYLE = {
  consegnata:      { icon: '✓', bgClass: 'bg-[rgba(196,168,130,0.10)] text-textMute' },
  in_finestra:     { icon: '🪟', bgClass: 'bg-successSoft text-success animate-pulseDot' },
  in_preparazione: { icon: '🔄', bgClass: 'bg-warningSoft text-warning' },
  sbloccata:       { icon: '🔴', bgClass: 'bg-dangerSoft text-danger animate-blink' },
  pre_riscaldo:    { icon: '🟡', bgClass: 'bg-warningSoft text-warning' },
  in_attesa:       { icon: '⬜', bgClass: 'bg-[rgba(196,168,130,0.10)] text-textSoft' },
  in_pausa:        { icon: '⏸', bgClass: 'bg-dangerSoft text-danger' },
  bloccata:        { icon: '🔒', bgClass: 'bg-[rgba(255,255,255,0.04)] text-textMute' },
}

export default function MandataIndicator({ source = 'cucina', mandata, stato, compact = true }) {
  const s = STATE_STYLE[stato] || STATE_STYLE.in_attesa
  const sourceIcon = source === 'cucina' ? '🍳' : '🍺'
  const num = String(mandata).replace(/^M/i, '')

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-badge tabular-nums
                  font-extrabold text-[11px] tracking-[0.3px]
                  ${compact ? 'px-1.5 py-[2px]' : 'px-2 py-[3px]'}
                  ${s.bgClass}`}
    >
      <span className="text-[11px]">{sourceIcon}</span>
      <span>M{num}</span>
      <span className="text-[12px]">{s.icon}</span>
    </span>
  )
}
