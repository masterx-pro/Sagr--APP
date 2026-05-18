import { useEffect, useState } from 'react'
import { Clock, Flame, Users, ChevronRight, Hourglass } from 'lucide-react'
import RushButton from './RushButton.jsx'

/**
 * KDSCard — card ordine per il Kitchen Display System.
 *
 * Props:
 *   order: {
 *     id, tavolo, cliente, persone, createdAt (ms),
 *     stato: 'sbloccata' | 'pre_riscaldo' | 'in_preparazione' | 'in_finestra',
 *     rush: bool,
 *     items: [{ nome, q, note?: [{icon,label,color}] }]
 *   }
 *   onAdvance(order)
 *   onRush(order)
 *   flying  — 'out' | 'in' | null
 *
 * Card responsive: i max-[600px] riducono badge/font/CTA su tablet 7-8"
 * portrait per evitare overflow ed UI gigante.
 */
export default function KDSCard({ order, onAdvance, onRush, flying = null }) {
  const elapsed = useElapsedSeconds(order.createdAt)
  const stateMeta = STATE_META[order.stato]

  const flyClass =
    flying === 'out' ? 'kds-fly-out'
    : flying === 'in' ? 'kds-fly-in'
    : ''

  return (
    <article
      className={[
        'relative flex flex-col bg-surface border border-borderSoft rounded-card-lg shadow-md',
        'overflow-hidden min-h-[140px]',
        stateMeta.cardExtra,
        order.rush ? 'kds-rush-glow' : '',
        flyClass,
      ].join(' ')}
      style={{
        borderLeftWidth: '4px',
        borderLeftColor: `var(--kds-accent-${order.stato})`,
        transition: 'transform 300ms cubic-bezier(.2,.7,.2,1), opacity 300ms cubic-bezier(.2,.7,.2,1)',
      }}
    >
      <style>{`
        :root {
          --kds-accent-sbloccata: #E84040;
          --kds-accent-pre_riscaldo: #F0A820;
          --kds-accent-in_preparazione: #F0A820;
          --kds-accent-in_finestra: #3AAA52;
        }
        @keyframes kds-fly-out {
          0%   { transform: translateX(0)    scale(1);    opacity: 1; }
          100% { transform: translateX(120px) scale(0.92); opacity: 0; }
        }
        @keyframes kds-fly-in {
          0%   { transform: translateX(-80px) scale(0.94); opacity: 0; }
          100% { transform: translateX(0)     scale(1);    opacity: 1; }
        }
        .kds-fly-out { animation: kds-fly-out 300ms cubic-bezier(.2,.7,.2,1) forwards; }
        .kds-fly-in  { animation: kds-fly-in  300ms cubic-bezier(.2,.7,.2,1) forwards; }

        @keyframes kds-rush-blink {
          0%, 100% { box-shadow: 0 0 0 2px rgba(232,64,64,0.85), 0 0 24px rgba(232,64,64,0.55); }
          50%      { box-shadow: 0 0 0 2px rgba(232,64,64,0.30), 0 0 12px rgba(232,64,64,0.20); }
        }
        .kds-rush-glow { animation: kds-rush-blink 1s ease-in-out infinite; }
      `}</style>

      {/* RUSH ribbon */}
      {order.rush && (
        <div className="absolute top-0 right-0 z-10 pointer-events-none">
          <div className="bg-danger text-bg font-extrabold text-[11px] sm-tablet:text-[10px]
                          uppercase tracking-[1.4px]
                          px-2.5 py-0.5 rounded-bl-card-lg flex items-center gap-1 shadow-md">
            <Flame size={12} strokeWidth={3} /> RUSH
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="flex items-start justify-between gap-3 px-3 pt-3 pb-2.5 sm-tablet:px-2.5 sm-tablet:pt-2.5">
        <div className="flex items-start gap-3 min-w-0 sm-tablet:gap-2">
          {/* Badge tavolo */}
          <div
            className="shrink-0 flex flex-col items-center justify-center
                       w-[52px] h-[52px] rounded-[14px]
                       sm-tablet:w-[40px] sm-tablet:h-[40px] sm-tablet:rounded-[10px]
                       bg-wineDeep border border-wine/60 text-text shadow-md"
          >
            <span className="text-[9px] sm-tablet:text-[8px] font-extrabold tracking-[1.2px]
                             text-gold leading-none">TAV</span>
            <span className="font-mono font-extrabold text-[26px] sm-tablet:text-[20px]
                             leading-none tabular-nums">
              {order.tavolo}
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-extrabold text-text text-[18px] sm-tablet:text-[16px]
                               leading-tight truncate">
                {order.cliente}
              </span>
              {order.mandataLabel && (
                <span className="shrink-0 inline-flex items-center justify-center
                                 px-1.5 h-[22px] sm-tablet:h-[20px] rounded-badge
                                 bg-surfaceElev border border-border
                                 font-mono font-extrabold text-[12px] sm-tablet:text-[11px]
                                 text-gold tabular-nums">
                  {order.mandataLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-textSoft
                            text-[13px] sm-tablet:text-[12px] font-semibold">
              <Users size={13} strokeWidth={2.5} />
              <span>{order.persone} pers.</span>
              {order.rush && <span className="text-danger font-extrabold ml-1">· URGENTE</span>}
            </div>
          </div>
        </div>

        <Timer seconds={elapsed} />
      </header>

      {/* ITEMS — height auto, contenuto cresce naturalmente */}
      <div className="px-3 py-1 sm-tablet:px-2.5">
        <ul className="flex flex-col">
          {order.items.slice(0, 6).map((it, idx) => (
            <li
              key={idx}
              className={[
                'flex items-start gap-3 py-2 sm-tablet:gap-2 sm-tablet:py-1.5',
                idx > 0 ? 'border-t border-borderSoft' : '',
              ].join(' ')}
            >
              <div className="shrink-0 w-9 h-9 sm-tablet:w-8 sm-tablet:h-8
                              rounded-badge bg-surfaceElev border border-border
                              flex items-center justify-center
                              font-extrabold text-[16px] sm-tablet:text-[14px]
                              text-text tabular-nums">
                {it.q}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-text text-[20px] sm-tablet:text-[16px]
                                font-semibold leading-tight break-words">
                  {it.nome}
                </div>
                {Array.isArray(it.note) && it.note.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {it.note.map((n, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-badge
                                   text-[12px] sm-tablet:text-[11px] font-bold border"
                        style={{
                          background: `${n.color}22`,
                          color: n.color,
                          borderColor: `${n.color}66`,
                        }}
                      >
                        <span>{n.icon}</span>
                        <span className="uppercase tracking-[0.4px]">{n.label}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
          {order.items.length > 6 && (
            <li className="text-[12px] text-textMute font-bold uppercase tracking-[1px] py-1.5">
              + altri {order.items.length - 6} piatti…
            </li>
          )}
        </ul>
      </div>

      {/* AZIONI — sempre visibili, mai overflow */}
      <footer className="mt-auto px-3 pt-2 pb-3 sm-tablet:px-2.5 sm-tablet:pb-2.5
                         flex items-stretch gap-2 border-t border-borderSoft bg-bg/30">
        <RushButton
          active={order.rush}
          size="md"
          onClick={() => onRush?.(order)}
        />
        <MainAction order={order} onAdvance={onAdvance} />
      </footer>
    </article>
  )
}

/* ───── TIMER ───── */

function Timer({ seconds }) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  const tone =
    seconds < 5 * 60    ? 'text-success'
    : seconds < 10 * 60 ? 'text-warning'
    :                     'text-danger animate-pulseUrgent'

  return (
    <div className={[
      'shrink-0 flex items-center gap-1.5 px-2 h-9 sm-tablet:h-8 sm-tablet:px-1.5 rounded-btn',
      'bg-bg/50 border border-borderSoft',
      tone,
    ].join(' ')}>
      <Clock size={15} strokeWidth={2.5} />
      <span className="font-mono font-extrabold text-[22px] sm-tablet:text-[18px]
                       tabular-nums leading-none">
        {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </span>
    </div>
  )
}

/* ───── CTA principale ───── */

function MainAction({ order, onAdvance }) {
  const meta = STATE_META[order.stato]

  if (order.stato === 'in_finestra') {
    return (
      <div className="flex-1 flex items-center justify-center gap-2
                      min-h-[64px] sm-tablet:min-h-[52px]
                      rounded-btn border-2 border-dashed border-success/50 bg-successSoft
                      text-success font-extrabold
                      text-[16px] sm-tablet:text-[13px]
                      uppercase tracking-[1.2px] text-center px-2">
        <Hourglass size={18} strokeWidth={2.5} />
        <span>Attende cameriere</span>
      </div>
    )
  }

  return (
    <button
      onClick={() => onAdvance?.(order)}
      className={[
        'flex-1 flex items-center justify-center gap-2',
        'min-h-[64px] sm-tablet:min-h-[52px]',
        'rounded-btn font-extrabold',
        'text-[18px] sm-tablet:text-[14px] uppercase tracking-[1px]',
        'shadow-cta active:scale-[0.98] transition-transform',
        meta.ctaCls,
      ].join(' ')}
    >
      <meta.ctaIcon size={20} strokeWidth={2.8} />
      <span className="text-center">{meta.ctaLabel}</span>
      <ChevronRight size={20} strokeWidth={3} />
    </button>
  )
}

/* ───── tempo trascorso ───── */

function useElapsedSeconds(startMs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, Math.floor((now - startMs) / 1000))
}

/* ───── meta per stato ───── */

const STATE_META = {
  sbloccata: {
    ctaLabel: 'Inizia preparazione',
    ctaCls: 'bg-gold text-bg',
    ctaIcon: Flame,
    cardExtra: 'ring-1 ring-danger/30',
  },
  pre_riscaldo: {
    ctaLabel: 'Inizia preparazione',
    ctaCls: 'bg-gold text-bg',
    ctaIcon: Flame,
    cardExtra: 'ring-1 ring-warning/40',
  },
  in_preparazione: {
    ctaLabel: 'Metti in finestra',
    ctaCls: 'bg-success text-bg',
    ctaIcon: ChevronRight,
    cardExtra: '',
  },
  in_finestra: {
    ctaLabel: '',
    ctaCls: '',
    ctaIcon: Hourglass,
    cardExtra: 'ring-1 ring-success/40',
  },
}
