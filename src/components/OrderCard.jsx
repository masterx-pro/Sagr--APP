import TableBadge from './TableBadge.jsx'

function formatDataOra(iso) {
  const d = new Date(iso)
  const data = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  const ora  = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return `${data} · ${ora}`
}

const STATO_COLORI = {
  aperto:         'bg-gray-600',
  cucina_pronta:  'bg-yellow-600',
  bar_pronto:     'bg-yellow-600',
  completo:       'bg-green-600',
  pagato:         'bg-blue-700'
}

const STATO_LABEL = {
  aperto:         'Aperto',
  cucina_pronta:  'Cucina pronta',
  bar_pronto:     'Bar pronto',
  completo:       'Pronto',
  pagato:         'Pagato'
}

/**
 * OrderCard: card di riepilogo di un ordine (usata dal cameriere e dall'admin).
 */
export default function OrderCard({ order, items = [], onClick, onDelete }) {
  const cucinaPronti = items.filter(i => i.categoria === 'cucina' && i.pronto).length
  const cucinaTot    = items.filter(i => i.categoria === 'cucina').length
  const barPronti    = items.filter(i => i.categoria === 'bar' && i.pronto).length
  const barTot       = items.filter(i => i.categoria === 'bar').length

  return (
    <div
      onClick={onClick}
      className="card cursor-pointer active:scale-[0.98] transition-transform"
    >
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <TableBadge numero={order.numero_tavolo} persone={order.n_persone} />
          {order.created_at && (
            <span className="text-xs text-gray-400">
              {formatDataOra(order.created_at)}
            </span>
          )}
        </div>
        <span className={`badge text-white ${STATO_COLORI[order.stato] || 'bg-gray-600'}`}>
          {STATO_LABEL[order.stato] || order.stato}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm mb-2">
        <div>
          <span className="opacity-70">🍳 Cucina:</span>{' '}
          <span className="font-semibold">
            {cucinaPronti}/{cucinaTot}
          </span>
        </div>
        <div>
          <span className="opacity-70">🍺 Bar:</span>{' '}
          <span className="font-semibold">
            {barPronti}/{barTot}
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
