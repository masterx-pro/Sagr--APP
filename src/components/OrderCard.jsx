import TableBadge from './TableBadge.jsx'

function formatDataOra(iso) {
  const d = new Date(iso)
  const data = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  const ora  = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return `${data} · ${ora}`
}

const STATO_COLORI = {
  bozza:        'bg-gray-600',
  attesa_cassa: 'bg-amber-600',
  confermato:   'bg-green-700',
  stornato:     'bg-red-700',
  completato:   'bg-blue-700',
}

const STATO_LABEL = {
  bozza:        'Bozza',
  attesa_cassa: '💵 In cassa',
  confermato:   'Confermato',
  stornato:     '⚠️ Stornato',
  completato:   'Completato',
}

const TIPO_PAGAMENTO_ICON = {
  bancomat: '💳',
  contanti: '💵',
}

/**
 * OrderCard v2: card di riepilogo usata dall'admin.
 * Mostra nome cliente, tipo pagamento, stato nuovo modello e conteggio
 * consegne (basato su mandata_stato === 'consegnata').
 */
export default function OrderCard({ order, items = [], onClick, onDelete }) {
  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')
  const cucinaConsegnati = cucinaItems.filter(i => i.mandata_stato === 'consegnata').length
  const barConsegnati    = barItems.filter(i => i.mandata_stato === 'consegnata').length

  const tipoIcon = TIPO_PAGAMENTO_ICON[order.tipo_pagamento]
  const statoLabel = STATO_LABEL[order.stato] || order.stato
  const statoColor = STATO_COLORI[order.stato] || 'bg-gray-600'

  return (
    <div
      onClick={onClick}
      className="card cursor-pointer active:scale-[0.98] transition-transform"
    >
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TableBadge numero={order.numero_tavolo} persone={order.n_persone} />
            {order.nome_cliente && (
              <span className="text-sm font-semibold opacity-90 truncate max-w-[10rem]">
                · {order.nome_cliente}
              </span>
            )}
          </div>
          {order.created_at && (
            <span className="text-xs text-gray-400">
              {formatDataOra(order.created_at)}
            </span>
          )}
          {order.cameriere_nome && (
            <span className="text-xs text-gray-500 italic">
              👤 {order.cameriere_nome}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`badge text-white ${statoColor}`}>
            {statoLabel}
          </span>
          {tipoIcon && (
            <span className="text-xs opacity-80">
              {tipoIcon} {order.tipo_pagamento}
            </span>
          )}
        </div>
      </div>

      {order.stato === 'stornato' && order.storno_note && (
        <p className="text-xs bg-red-900/40 border border-red-700 rounded-lg p-2 mb-2 break-words">
          Storno: {order.storno_note}
        </p>
      )}

      <div className="flex flex-col gap-1 text-sm mb-2">
        <div>
          <span className="opacity-70">🍳 Cucina:</span>{' '}
          <span className="font-semibold">
            {cucinaConsegnati}/{cucinaItems.length}
          </span>
        </div>
        <div>
          <span className="opacity-70">🍺 Bar:</span>{' '}
          <span className="font-semibold">
            {barConsegnati}/{barItems.length}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-bordo">
        <span className="text-lg font-bold">
          € {Number(order.totale).toFixed(2)}
        </span>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(order.id) }}
            className="text-xs px-2 py-1 rounded-lg bg-red-700 text-white"
          >
            Elimina
          </button>
        )}
      </div>
    </div>
  )
}
