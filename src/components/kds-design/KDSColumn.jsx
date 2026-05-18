import { useState, useEffect } from 'react'
import KDSCard from './KDSCard.jsx'

/**
 * KDSColumn — singola colonna del KDS a 3 colonne.
 *
 * Props:
 *   id: 'da-fare' | 'in-corso' | 'in-finestra'
 *   title, icon, tone
 *   orders[]
 *   flashing  — quando true, lampeggia per 200ms (target di una transizione)
 *   flyingIds — Set<string> di id che stanno entrando/uscendo
 *   flyingDirection — 'in' | 'out' associato a quegli id
 *   onAdvance(order), onRush(order)
 */
export default function KDSColumn({
  id,
  title,
  icon,
  tone,                  // 'danger' | 'warning' | 'success'
  orders,
  flashing = false,
  flyingIds = new Set(),
  flyingDirection = null,
  onAdvance,
  onRush,
}) {
  const t = TONES[tone]

  // Le card RUSH salgono sempre in cima
  const sortedOrders = [...orders].sort((a, b) => {
    if (a.rush && !b.rush) return -1
    if (!a.rush && b.rush) return 1
    return a.createdAt - b.createdAt
  })

  return (
    <section
      className={[
        'flex flex-col h-full min-h-0',
        'bg-bg/40 border border-borderSoft rounded-card-lg overflow-hidden',
        flashing ? 'kds-col-flash' : '',
      ].join(' ')}
      style={{
        boxShadow: flashing ? `inset 0 0 0 2px ${t.flashColor}` : undefined,
        transition: 'box-shadow 200ms ease-out',
      }}
    >
      <style>{`
        @keyframes kds-col-flash {
          0%   { background-color: ${t.flashBg}; }
          100% { background-color: transparent; }
        }
        .kds-col-flash { animation: kds-col-flash 200ms ease-out; }
      `}</style>

      {/* Header colonna */}
      <header
        className={[
          'flex items-center justify-between gap-2 px-3 py-2.5 border-b',
          t.headerBg,
          t.headerBorder,
        ].join(' ')}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[18px]">{icon}</span>
          <h2
            className={[
              'font-extrabold text-[13px] uppercase truncate',
              t.headerText,
            ].join(' ')}
            style={{ letterSpacing: '2px' }}
          >
            {title}
          </h2>
        </div>
        <span
          className={[
            'inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-full',
            'font-mono font-extrabold text-[14px] tabular-nums',
            t.badgeBg,
            t.badgeText,
          ].join(' ')}
        >
          {orders.length}
        </span>
      </header>

      {/* Lista card — scroll interno indipendente per colonna.
          overscroll-contain evita che lo scroll "rimbalzi" sul body.
          WebkitOverflowScrolling abilita momentum scroll su iOS/Android. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5
                   flex flex-col gap-2.5"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {sortedOrders.length === 0 ? (
          <EmptyState tone={tone} id={id} />
        ) : (
          sortedOrders.map(order => (
            <KDSCard
              key={order.id}
              order={order}
              onAdvance={onAdvance}
              onRush={onRush}
              flying={
                flyingIds.has(order.id) ? flyingDirection : null
              }
            />
          ))
        )}
      </div>
    </section>
  )
}

function EmptyState({ tone, id }) {
  const messages = {
    'da-fare':     { icon: '✨', text: 'Nessun ordine\nda iniziare' },
    'in-corso':    { icon: '🍳', text: 'Niente in corso\nin questo momento' },
    'in-finestra': { icon: '🪟', text: 'Finestra vuota\ntutto consegnato' },
  }
  const m = messages[id] || { icon: '·', text: 'Vuota' }
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10
                    text-textMute text-center">
      <span className="text-[40px] opacity-60">{m.icon}</span>
      <p className="text-[14px] font-bold uppercase tracking-[1.4px] whitespace-pre-line">
        {m.text}
      </p>
    </div>
  )
}

const TONES = {
  danger: {
    headerBg:     'bg-dangerSoft',
    headerBorder: 'border-danger/40',
    headerText:   'text-danger',
    badgeBg:      'bg-danger',
    badgeText:    'text-bg',
    flashColor:   'rgba(232,64,64,0.6)',
    flashBg:      'rgba(232,64,64,0.10)',
  },
  warning: {
    headerBg:     'bg-warningSoft',
    headerBorder: 'border-warning/40',
    headerText:   'text-warning',
    badgeBg:      'bg-warning',
    badgeText:    'text-bg',
    flashColor:   'rgba(240,168,32,0.6)',
    flashBg:      'rgba(240,168,32,0.10)',
  },
  success: {
    headerBg:     'bg-successSoft',
    headerBorder: 'border-success/40',
    headerText:   'text-success',
    badgeBg:      'bg-success',
    badgeText:    'text-bg',
    flashColor:   'rgba(58,170,82,0.6)',
    flashBg:      'rgba(58,170,82,0.10)',
  },
}
