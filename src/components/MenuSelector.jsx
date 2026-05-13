import { useMemo, useState } from 'react'

const PORTATE_CUCINA = [
  { label: 'Antipasti', test: o => o >= 1  && o <= 9  },
  { label: 'Primi',     test: o => o >= 10 && o <= 19 },
  { label: 'Secondi',   test: o => o >= 20 && o <= 29 },
  { label: 'Dolci',     test: o => o >= 30 && o <= 39 },
]

const PORTATE_BAR = [
  { label: 'Acqua',                   test: o => o >= 1  && o <= 9  },
  { label: 'Vino sfuso',              test: o => o >= 10 && o <= 19 },
  { label: 'Verdicchio',              test: o => o >= 20 && o <= 29 },
  { label: "Lacrima di Morro d'Alba", test: o => o >= 30 && o <= 39 },
  { label: 'Caffè',                   test: o => o >= 40 && o <= 49 },
  { label: 'Amari',                   test: o => o >= 50 && o <= 59 },
]

function groupByPortata(items, schema) {
  const groups = schema.map(p => ({
    label: p.label,
    items: items.filter(i => p.test(i.ordine ?? 0)),
  }))
  const altro = items.filter(i => !schema.some(p => p.test(i.ordine ?? 0)))
  if (altro.length) groups.push({ label: 'Altro', items: altro })
  return groups.filter(g => g.items.length > 0)
}

/**
 * MenuSelector: tab Cucina/Bar + lista voci con +/- per quantità.
 * Controlla via callback onChange la mappa { itemId: quantity }.
 */
export default function MenuSelector({ items, quantities, onChange }) {
  const [tab, setTab] = useState('cucina')

  const filtered = useMemo(
    () => (items || [])
      .filter(i => i.attivo !== false && i.categoria === tab)
      .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)),
    [items, tab]
  )

  const grouped = useMemo(
    () => groupByPortata(filtered, tab === 'cucina' ? PORTATE_CUCINA : PORTATE_BAR),
    [tab, filtered]
  )

  const setQty = (id, delta) => {
    const current = quantities[id] || 0
    const next = Math.max(0, current + delta)
    const updated = { ...quantities }
    if (next === 0) delete updated[id]
    else updated[id] = next
    onChange(updated)
  }

  return (
    <div>
      <div className="flex gap-2 mb-3 sticky top-0 bg-sfondo pt-2 pb-2 z-10">
        <button
          onClick={() => setTab('cucina')}
          className={`flex-1 min-h-btn rounded-xl font-semibold ${
            tab === 'cucina'
              ? 'bg-cucina text-white'
              : 'bg-pannello border border-bordo'
          }`}
        >
          Cucina
        </button>
        <button
          onClick={() => setTab('bar')}
          className={`flex-1 min-h-btn rounded-xl font-semibold ${
            tab === 'bar'
              ? 'bg-bar text-white'
              : 'bg-pannello border border-bordo'
          }`}
        >
          Bar
        </button>
      </div>

      <ul className="space-y-2">
        {filtered.length === 0 && (
          <li className="text-center opacity-60 py-6">
            Nessuna voce disponibile
          </li>
        )}
        {grouped
          ? grouped.flatMap(g => [
              <li
                key={`hdr-${g.label}`}
                className="bg-black/40 border-y border-bordo py-2 text-center
                           text-sm font-bold uppercase tracking-widest opacity-90"
              >
                — {g.label} —
              </li>,
              ...g.items.map(item => renderItemRow(item, quantities, setQty)),
            ])
          : filtered.map(item => renderItemRow(item, quantities, setQty))}
      </ul>
    </div>
  )
}

function renderItemRow(item, quantities, setQty) {
  const q = quantities[item.id] || 0
  return (
    <li key={item.id} className="card flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate">{item.nome}</p>
        <p className="text-sm opacity-80">
          € {Number(item.prezzo).toFixed(2)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setQty(item.id, -1)}
          disabled={q === 0}
          className="w-11 h-11 rounded-xl bg-red-700 font-bold text-xl
                     active:scale-95 transition-transform disabled:opacity-30"
        >
          −
        </button>
        <span className="w-8 text-center text-lg font-bold">{q}</span>
        <button
          onClick={() => setQty(item.id, +1)}
          className="w-11 h-11 rounded-xl bg-green-700 font-bold text-xl
                     active:scale-95 transition-transform"
        >
          +
        </button>
      </div>
    </li>
  )
}
