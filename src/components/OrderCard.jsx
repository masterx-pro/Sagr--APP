import TableBadge from './TableBadge.jsx'
import { CreditCard, Banknote, Users, Clock, AlertTriangle } from 'lucide-react'

function formatDataOra(iso) {
  const d = new Date(iso)
  const data = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  const ora  = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return `${data} · ${ora}`
}

// Mappa stato → token (border-left color + banner)
const STATO_META = {
  bozza:        { borderCls: 'border-l-textSoft', bannerCls: 'bg-[rgba(196,168,130,0.14)] text-textSoft', label: 'BOZZA' },
  attesa_cassa: { borderCls: 'border-l-gold',     bannerCls: 'bg-goldSoft text-gold',                  label: 'ATTESA CASSA' },
  confermato:   { borderCls: 'border-l-success',  bannerCls: 'bg-successSoft text-success',           label: 'CONFERMATO' },
  stornato:     { borderCls: 'border-l-danger',   bannerCls: 'bg-dangerSoft text-danger',             label: 'STORNATO' },
  completato:   { borderCls: 'border-l-info',     bannerCls: 'bg-infoSoft text-info',                 label: 'COMPLETATO' },
}

/**
 * OrderCard — card riepilogo usata dall'Admin (dark theme).
 * Mostra cliente, pagamento, stato, conteggio consegne cucina/bar.
 */
export default function OrderCard({ order, items = [], onClick, onDelete }) {
  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')
  const cucinaConsegnati = cucinaItems.filter(i => i.mandata_stato === 'consegnata').length
  const barConsegnati    = barItems.filter(i => i.mandata_stato === 'consegnata').length

  const meta = STATO_META[order.stato] || STATO_META.bozza
  const isStorno = order.stato === 'stornato'
  const isContanti = order.tipo_pagamento === 'contanti'

  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer active:scale-[0.98] transition-transform
                  bg-surface border border-borderSoft border-l-4 ${meta.borderCls}
                  rounded-card p-3 shadow-sm flex flex-col gap-2.5`}
    >
      {/* row 1: header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TableBadge numero={order.numero_tavolo} persone={order.n_persone} />
            {order.nome_cliente && (
              <span className="text-[15px] font-bold truncate max-w-[10rem] text-text">
                · {order.nome_cliente}
              </span>
            )}
          </div>
          {order.created_at && (
            <span className="text-xs text-textSoft tabular-nums">
              {formatDataOra(order.created_at)}
            </span>
          )}
          {order.cameriere_nome && (
            <span className="text-xs text-textMute italic">
              👤 {order.cameriere_nome}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[19px] font-extrabold tabular-nums text-text leading-none">
            € {Number(order.totale).toFixed(2)}
          </span>
          {order.tipo_pagamento && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-[3px] rounded-badge
                          text-[10.5px] font-extrabold tracking-wide
                          ${isContanti
                            ? 'bg-successSoft text-success'
                            : 'bg-infoSoft text-info'}`}
            >
              {isContanti ? <Banknote size={11} /> : <CreditCard size={11} />}
              {isContanti ? 'CONT' : 'BANC'}
            </span>
          )}
        </div>
      </div>

      {isStorno && order.storno_note && (
        <p className="text-xs bg-dangerSoft border border-danger/40 rounded-badge p-2 break-words text-danger">
          <AlertTriangle size={12} className="inline mr-1" />
          Storno: {order.storno_note}
        </p>
      )}

      {/* row 2: progress */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-textSoft">
        <span>
          🍳 <span className="font-bold text-text tabular-nums">{cucinaConsegnati}/{cucinaItems.length}</span>
        </span>
        <span>
          🍺 <span className="font-bold text-text tabular-nums">{barConsegnati}/{barItems.length}</span>
        </span>
      </div>

      {/* row 3: banner stato */}
      <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-[10px]
                       text-[11px] font-extrabold uppercase tracking-[0.6px]
                       ${meta.bannerCls}`}>
        <span>{meta.label}</span>
        {isStorno && <AlertTriangle size={12} />}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(order.id) }}
            className="px-2 py-0.5 rounded-badge bg-danger text-text text-[10px] font-extrabold uppercase"
          >
            Elimina
          </button>
        )}
      </div>
    </div>
  )
}
