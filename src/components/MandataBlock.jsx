import { Clock, AlertTriangle } from 'lucide-react'

/**
 * MandataBlock — blocco mandata in cucina / bar / dettaglio cameriere.
 *
 * Props:
 *  - source: 'cucina'|'bar'
 *  - mandataNum: numero mandata (1..4) o string "M1".."M4"
 *  - items: [{ q: number, n: string }]
 *  - stato: 'in_attesa' | 'in_preparazione' | 'pronto' | 'consegnata' | 'bloccata'
 *  - timerSec?: secondi rimanenti (negativo = scaduto)
 *  - urgente?: bool
 *  - paused?: bool   → overlay diagonale + pill IN PAUSA
 *  - prevLabel?: string da concatenare al label "bloccata"
 *  - onAdvance?: callback CTA → stato successivo
 */

const STAGES = {
  in_attesa: {
    label: 'Da preparare', next: 'In preparazione',
    icon: '📋',
    headerCls: 'text-textSoft',
    rowBg: 'bg-[rgba(196,168,130,0.10)]',
    ctaBg: 'bg-gold text-bg',
  },
  in_preparazione: {
    label: 'In preparazione', next: 'Pronto',
    icon: '🔄',
    headerCls: 'text-warning',
    rowBg: 'bg-warningSoft',
    ctaBg: 'bg-success text-bg',
  },
  pronto: {
    label: 'Pronto', next: 'Consegnata',
    icon: '✅',
    headerCls: 'text-success',
    rowBg: 'bg-successSoft',
    ctaBg: 'bg-success text-bg',
  },
  consegnata: {
    label: 'Consegnata', next: null,
    icon: '✓',
    headerCls: 'text-textMute',
    rowBg: 'bg-[rgba(196,168,130,0.06)]',
    ctaBg: null,
  },
  bloccata: {
    label: 'In attesa M', next: null,
    icon: '🔒',
    headerCls: 'text-textMute',
    rowBg: 'bg-[rgba(196,168,130,0.06)]',
    ctaBg: null,
    locked: true,
  },
}

function fmtTime(sec) {
  const s = Math.abs(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function MandataBlock({
  source = 'cucina',
  mandataNum,
  items = [],
  stato = 'in_attesa',
  timerSec,
  urgente = false,
  paused = false,
  prevLabel,
  onAdvance,
  ctaLabel,
}) {
  const stage = STAGES[stato] || STAGES.in_attesa
  const done = stato === 'consegnata'
  const overdue = timerSec != null && timerSec < 0
  const sourceIcon = source === 'cucina' ? '🍳' : '🍺'
  const num = String(mandataNum).replace(/^M/i, '')

  // border / glow logic
  const borderCls = overdue
    ? 'border-danger shadow-alert'
    : urgente
      ? 'border-wine shadow-wine'
      : stage.locked
        ? 'border-borderSoft shadow-sm'
        : 'border-border shadow-sm'

  return (
    <div
      className={`relative rounded-card p-3 border-[1.5px] ${borderCls}
                  ${done ? 'bg-[rgba(196,168,130,0.04)] opacity-60' : 'bg-surface'}`}
    >
      {paused && (
        <div
          className="absolute inset-0 rounded-[inherit] z-10 flex items-center justify-center
                     text-danger font-extrabold uppercase tracking-[1.2px] text-[13px]"
          style={{
            background:
              'repeating-linear-gradient(45deg, rgba(232,64,64,0.18) 0 10px, rgba(232,64,64,0.08) 10px 20px)',
          }}
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-phone border border-danger
                          bg-[rgba(26,15,10,0.85)]">
            <AlertTriangle size={14} /> IN PAUSA
          </div>
        </div>
      )}

      {/* header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-[9px]
                       bg-surfaceElev border border-border text-base"
          >
            {sourceIcon}
          </span>
          <div>
            <div className="text-[14px] font-extrabold tracking-[0.4px] text-text">
              MANDATA {num}
              {urgente && (
                <span className="ml-1.5 text-wine text-[11px] font-extrabold">⚡ URGENTE</span>
              )}
            </div>
            <div className={`text-[11px] font-bold uppercase tracking-[0.4px] mt-[1px] ${stage.headerCls}`}>
              {stage.icon} {stage.locked ? `${stage.label}${prevLabel || ''}` : stage.label}
            </div>
          </div>
        </div>
        {timerSec != null && stato !== 'consegnata' && (
          <div
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-phone tabular-nums
                        text-[12px] font-extrabold border
                        ${overdue
                          ? 'bg-dangerSoft text-danger border-danger'
                          : 'bg-surfaceElev text-textSoft border-border'}`}
          >
            <Clock size={12} />
            {overdue ? '-' : ''}{fmtTime(timerSec)}
          </div>
        )}
      </div>

      {/* items */}
      <div className={`flex flex-col gap-1.5 ${stage.locked ? 'opacity-55' : ''}`}>
        {items.map((it, i) => (
          <div
            key={i}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[10px]
                        ${stage.rowBg} border border-borderSoft`}
          >
            <span
              className="min-w-[36px] h-[30px] px-2.5 rounded-badge inline-flex items-center justify-center
                         bg-surfaceElev text-text font-extrabold text-[15px] tabular-nums border border-border"
            >
              {it.q}×
            </span>
            <span
              className={`flex-1 text-[15px] font-semibold break-words
                          ${done ? 'line-through text-textMute' : 'text-text'}`}
            >
              {it.n}
            </span>
          </div>
        ))}
      </div>

      {/* CTA */}
      {!done && !stage.locked && stage.next && onAdvance && (
        <button
          onClick={onAdvance}
          className={`w-full mt-2.5 min-h-[50px] rounded-btn font-extrabold tracking-[0.4px] text-[15px]
                      inline-flex items-center justify-center gap-2 ${stage.ctaBg}
                      shadow-[0_3px_0_#3F2A1F] active:scale-95 transition-transform`}
        >
          → {ctaLabel || stage.next}
        </button>
      )}
    </div>
  )
}
