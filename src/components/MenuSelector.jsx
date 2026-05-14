import { useMemo, useState } from 'react'
import { isBarMandata2 } from '../utils/servizio.js'

/**
 * MenuSelector v2:
 *   - Tab mandata in alto: M1 / M2 / M3
 *   - Tab categoria: Cucina / Bar
 *   - Le voci bar caffe'/amari (ordine >= 40) sono sempre forzate a M2
 *     indipendentemente dal tab attivo.
 *
 * Modello dati di `quantities`:
 *   { [itemId]: { quantita: number, mandata: number } }
 *
 * Quando l'utente preme "+" su un item, la mandata applicata e' quella
 * del tab attivo (o 2 se l'item e' bar M2-forzato). Tappare "+" su un
 * item gia' presente in un'altra mandata lo sposta nella mandata corrente.
 */

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

export default function MenuSelector({ items, quantities, onChange }) {
  const [mandataAttiva, setMandataAttiva] = useState(1)
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

  // Conta items selezionati per ciascuna mandata (per badge sui tab)
  const contoPerMandata = useMemo(() => {
    const tot = { 1: 0, 2: 0, 3: 0 }
    for (const v of Object.values(quantities || {})) {
      if (v && tot[v.mandata] != null) tot[v.mandata] += v.quantita
    }
    return tot
  }, [quantities])

  const setQty = (item, delta) => {
    const cur = quantities[item.id]
    const curQ = cur?.quantita || 0
    const next = Math.max(0, curQ + delta)
    const forced = isBarMandata2(item)
    const mandataDaApplicare = forced ? 2 : mandataAttiva
    const updated = { ...quantities }
    if (next === 0) delete updated[item.id]
    else updated[item.id] = { quantita: next, mandata: mandataDaApplicare }
    onChange(updated)
  }

  return (
    <div>
      {/* Tab mandata */}
      <div className="flex gap-2 mb-2 sticky top-0 bg-sfondo pt-2 z-20">
        {[1, 2, 3].map(n => {
          const active = mandataAttiva === n
          const count = contoPerMandata[n]
          return (
            <button
              key={n}
              type="button"
              onClick={() => setMandataAttiva(n)}
              className={`flex-1 min-h-btn rounded-xl font-bold text-sm
                          relative ${
                active
                  ? 'bg-cameriere text-white'
                  : 'bg-pannello border border-bordo'
              }`}
            >
              M{n}
              {count > 0 && (
                <span className="ml-2 text-xs font-normal opacity-90">
                  · {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab categoria */}
      <div className="flex gap-2 mb-3 sticky top-[3.25rem] bg-sfondo pt-1 pb-2 z-10">
        <button
          type="button"
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
          type="button"
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
  const cur = quantities[item.id]
  const q = cur?.quantita || 0
  const mandataItem = cur?.mandata
  const forced = isBarMandata2(item)

  return (
    <li
      key={item.id}
      className={`card flex items-start gap-3 ${forced ? 'bg-yellow-900/15' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold break-words whitespace-normal">
            {item.nome}
          </p>
          {forced && (
            <span className="text-[10px] px-2 py-0.5 rounded-full
                             bg-yellow-900/50 border border-yellow-700 uppercase tracking-wide">
              🔒 fine pasto · M2
            </span>
          )}
          {q > 0 && mandataItem != null && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase
                              tracking-wide bg-cameriere/40 border border-cameriere`}>
              M{mandataItem}
            </span>
          )}
        </div>
        <p className="text-sm opacity-80">€ {Number(item.prezzo).toFixed(2)}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setQty(item, -1)}
          disabled={q === 0}
          className="w-11 h-11 rounded-xl bg-red-700 font-bold text-xl
                     active:scale-95 transition-transform disabled:opacity-30"
        >
          −
        </button>
        <span className="w-8 text-center text-lg font-bold">{q}</span>
        <button
          type="button"
          onClick={() => setQty(item, +1)}
          className="w-11 h-11 rounded-xl bg-green-700 font-bold text-xl
                     active:scale-95 transition-transform"
        >
          +
        </button>
      </div>
    </li>
  )
}
