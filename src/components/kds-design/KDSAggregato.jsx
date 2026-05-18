import { useMemo, useState } from 'react'
import { Flame, Check, Hourglass } from 'lucide-react'

/**
 * KDSAggregato — vista aggregata 2 colonne landscape.
 *
 * Colonna sinistra: DA IMPIATTARE ORA   (sbloccata + pre_riscaldo + in_preparazione)
 * Colonna destra:   IN ATTESA           (in_attesa → ancora bloccata, qui simulato
 *                                        come "nessun ordine in attesa" perche'
 *                                        nel mock non passiamo voci bloccate)
 *
 * Aggrega per nome_item, accumulando le quantita' e i tavoli.
 *
 * Props:
 *   orders[]      — gli stessi del layout principale
 *   role          — 'cucina' | 'bar' (cambia icone/label minori)
 *   onAdvance(virtualOrder) — opzionale, qui marca "TUTTO PRONTO" su un piatto
 *
 * NB: questa vista e' un prototipo di refresh dell'esistente: i CTA "TUTTO PRONTO"
 * non mutano lo stato DB nel demo, solo lo stato locale.
 */
export default function KDSAggregato({ orders, role = 'cucina', onAdvance }) {
  const aggregate = useMemo(() => buildAggregate(orders), [orders])

  const daImpiattare = aggregate.filter(a => a.attivi > 0)
  const inAttesa     = aggregate.filter(a => a.inAttesa > 0)

  return (
    <div className="h-full grid grid-cols-2 gap-3">
      <AggregateColumn
        title="Da impiattare ora"
        icon="🔴"
        tone="danger"
        items={daImpiattare}
        kind="attivi"
        onAdvance={onAdvance}
      />
      <AggregateColumn
        title="In attesa"
        icon="⬜"
        tone="muted"
        items={inAttesa}
        kind="inAttesa"
        onAdvance={null}
      />
    </div>
  )
}

function AggregateColumn({ title, icon, tone, items, kind, onAdvance }) {
  const total = items.reduce(
    (s, it) => s + (kind === 'attivi' ? it.attivi : it.inAttesa),
    0
  )
  const t = TONES[tone]

  return (
    <section
      className={[
        'flex flex-col h-full min-h-0 bg-bg/40 border border-borderSoft',
        'rounded-card-lg overflow-hidden',
      ].join(' ')}
    >
      <header
        className={[
          'flex items-center justify-between px-3 py-2.5 border-b',
          t.bg, t.border,
        ].join(' ')}
      >
        <div className="flex items-center gap-2">
          <span className="text-[18px]">{icon}</span>
          <h2
            className={['font-extrabold text-[13px] uppercase', t.text].join(' ')}
            style={{ letterSpacing: '2px' }}
          >
            {title}
          </h2>
        </div>
        <span
          className={[
            'inline-flex items-center justify-center min-w-[40px] h-7 px-2 rounded-full',
            'font-mono font-extrabold text-[14px] tabular-nums',
            t.badgeBg, t.badgeText,
          ].join(' ')}
        >
          {total}
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2.5">
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-textMute">
            <span className="text-[40px] opacity-60">✨</span>
            <p className="text-[14px] font-bold uppercase tracking-[1.4px] mt-2">
              Niente qui
            </p>
          </div>
        ) : items.map(it => (
          <DishRow key={it.nome} item={it} kind={kind} onAdvance={onAdvance} />
        ))}
      </div>
    </section>
  )
}

function DishRow({ item, kind, onAdvance }) {
  const qty = kind === 'attivi' ? item.attivi : item.inAttesa
  const urgent = kind === 'attivi' && item.hasUrgent

  return (
    <div className={[
      'rounded-card-lg bg-surface border shadow-md p-3',
      urgent ? 'border-danger ring-1 ring-danger/30' : 'border-borderSoft',
    ].join(' ')}>
      <div className="flex items-start gap-3">
        {/* Badge quantita' totale */}
        <div
          className={[
            'shrink-0 w-12 h-12 rounded-card flex items-center justify-center',
            'font-mono font-extrabold tabular-nums shadow-md',
            urgent
              ? 'bg-danger text-bg animate-pulseUrgent'
              : 'bg-gold text-bg',
          ].join(' ')}
        >
          <span className="text-[24px] leading-none">{qty}</span>
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-text font-extrabold text-[20px] leading-tight break-words">
            {item.nome}
          </h3>
          <p className="text-textSoft text-[14px] font-bold mt-1 break-words tabular-nums">
            {item.byTavolo
              .filter(t => (kind === 'attivi' ? t.attivi > 0 : t.inAttesa > 0))
              .map(t => `Tav.${t.tavolo} ×${kind === 'attivi' ? t.attivi : t.inAttesa}`)
              .join(' · ')}
          </p>
        </div>
      </div>

      {kind === 'attivi' && onAdvance && (
        <button
          onClick={() => onAdvance({ aggregateName: item.nome })}
          className="mt-3 w-full min-h-[52px] rounded-btn bg-success text-bg
                     font-extrabold text-[16px] uppercase tracking-[1px]
                     shadow-cta active:scale-[0.98] transition-transform
                     inline-flex items-center justify-center gap-2"
        >
          <Check size={20} strokeWidth={2.8} />
          Tutto pronto
        </button>
      )}

      {kind === 'inAttesa' && (
        <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn
                        bg-bg/40 border border-borderSoft text-textMute
                        text-[12px] font-extrabold uppercase tracking-[1px]">
          <Hourglass size={14} />
          Bloccato — attende sblocco cameriere
        </div>
      )}
    </div>
  )
}

/* ───── aggregazione ───── */

function buildAggregate(orders) {
  const map = new Map()
  for (const order of orders) {
    for (const it of order.items) {
      const cur = map.get(it.nome) ?? {
        nome: it.nome,
        attivi: 0,
        inAttesa: 0,
        hasUrgent: false,
        byTavolo: new Map(),
      }

      const isAttivo = ['sbloccata', 'pre_riscaldo', 'in_preparazione'].includes(order.stato)
      const isInAttesa = order.stato === 'in_attesa'

      if (isAttivo)   cur.attivi   += it.q
      if (isInAttesa) cur.inAttesa += it.q
      if (order.rush || order.stato === 'sbloccata') cur.hasUrgent = true

      const t = cur.byTavolo.get(order.tavolo) ?? { tavolo: order.tavolo, attivi: 0, inAttesa: 0 }
      if (isAttivo)   t.attivi   += it.q
      if (isInAttesa) t.inAttesa += it.q
      cur.byTavolo.set(order.tavolo, t)

      map.set(it.nome, cur)
    }
  }
  return Array.from(map.values()).map(v => ({
    ...v,
    byTavolo: Array.from(v.byTavolo.values()).sort((a, b) => a.tavolo - b.tavolo),
  }))
}

const TONES = {
  danger: {
    bg: 'bg-dangerSoft', border: 'border-danger/40', text: 'text-danger',
    badgeBg: 'bg-danger', badgeText: 'text-bg',
  },
  muted: {
    bg: 'bg-surfaceElev', border: 'border-borderSoft', text: 'text-textSoft',
    badgeBg: 'bg-surfaceHi', badgeText: 'text-textSoft',
  },
}
