import { useMemo, useState } from 'react'
import { getMandataPerItem, isBarMandata4 } from '../utils/servizio.js'

/**
 * MenuSelector v3:
 *   - 4 tabs mandata: M1 (antipasti) / M2 (primi) / M3 (secondi+contorni) / M4 (dolci+caffe+amari)
 *   - La mandata di un item e' SEMPRE derivata dalla sottocategoria
 *     (autoritativo via getMandataPerItem). L'utente non assegna la mandata,
 *     i tab servono solo da filtro/visualizzazione.
 *   - Nel tab mandata corrente: items della mandata interattivi (+/-)
 *   - Items gia' selezionati nelle mandate precedenti: visibili in grigio,
 *     +/- disabilitati, badge "M{n}" del loro effettivo numero.
 *   - Items M4 in modalita' "M4 bloccata": badge 🔒, +/- disabilitati.
 *
 * Props:
 *   - items: lista menu_items
 *   - quantities: { [itemId]: { quantita, mandata } }
 *   - onChange(newQuantities)
 *   - mandateAbilitate: array di numeri di mandata abilitati al click.
 *       default [1,2,3,4]. Per "nuovo ordine" pass [1,2,3].
 *       Per "Sblocca M4 → aggiungi" pass [4] (mostra solo M4 abilitata).
 */

const PORTATE_CUCINA = [
  { label: 'Antipasti', test: o => o >= 1  && o <= 9  },
  { label: 'Primi',     test: o => o >= 10 && o <= 19 },
  { label: 'Secondi',   test: o => o >= 20 && o <= 29 },
  { label: 'Contorni',  test: o => o >= 40 && o <= 49 },
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

export default function MenuSelector({
  items,
  quantities,
  onChange,
  mandateAbilitate = [1, 2, 3, 4],
}) {
  // Sceglie la prima mandata abilitata come tab di default
  const [mandataAttiva, setMandataAttiva] = useState(mandateAbilitate[0] ?? 1)
  const [tab, setTab] = useState('cucina')

  const itemsAttivi = useMemo(
    () => (items || []).filter(i => i.attivo !== false),
    [items]
  )

  // Items della categoria corrente, ordinati. Mostro TUTTI (la mandata di
  // appartenenza la calcolo per ogni item, e marco grigi i fuori-tab).
  const itemsCategoria = useMemo(
    () => itemsAttivi
      .filter(i => i.categoria === tab)
      .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)),
    [itemsAttivi, tab]
  )

  const grouped = useMemo(
    () => groupByPortata(itemsCategoria, tab === 'cucina' ? PORTATE_CUCINA : PORTATE_BAR),
    [tab, itemsCategoria]
  )

  // Conteggio pezzi gia' selezionati per mandata (per badge sul tab)
  const contoPerMandata = useMemo(() => {
    const tot = { 1: 0, 2: 0, 3: 0, 4: 0 }
    for (const v of Object.values(quantities || {})) {
      if (v && tot[v.mandata] != null) tot[v.mandata] += v.quantita
    }
    return tot
  }, [quantities])

  const setQty = (item, delta) => {
    const cur = quantities[item.id]
    const curQ = cur?.quantita || 0
    const next = Math.max(0, curQ + delta)
    // La mandata e' AUTORITATIVAMENTE derivata dall'item
    const mandata = getMandataPerItem(item)
    const updated = { ...quantities }
    if (next === 0) delete updated[item.id]
    else updated[item.id] = { quantita: next, mandata }
    onChange(updated)
  }

  return (
    <div>
      {/* Tab mandata */}
      <div className="flex gap-2 mb-2 sticky top-0 bg-sfondo pt-2 z-20">
        {[1, 2, 3, 4].map(n => {
          const active = mandataAttiva === n
          const count = contoPerMandata[n]
          const disabled = !mandateAbilitate.includes(n)
          return (
            <button
              key={n}
              type="button"
              onClick={() => !disabled && setMandataAttiva(n)}
              disabled={disabled}
              className={`flex-1 min-h-btn rounded-xl font-bold text-sm relative
                          ${active ? 'bg-cameriere text-white' : 'bg-pannello border border-bordo'}
                          ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {n === 4 && disabled ? '🔒 ' : ''}M{n}
              {count > 0 && (
                <span className="ml-1 text-xs font-normal opacity-90">· {count}</span>
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
            tab === 'cucina' ? 'bg-cucina text-white' : 'bg-pannello border border-bordo'
          }`}
        >
          Cucina
        </button>
        <button
          type="button"
          onClick={() => setTab('bar')}
          className={`flex-1 min-h-btn rounded-xl font-semibold ${
            tab === 'bar' ? 'bg-bar text-white' : 'bg-pannello border border-bordo'
          }`}
        >
          Bar
        </button>
      </div>

      <ul className="space-y-2">
        {itemsCategoria.length === 0 && (
          <li className="text-center opacity-60 py-6">
            Nessuna voce disponibile
          </li>
        )}
        {grouped.flatMap(g => [
          <li
            key={`hdr-${g.label}`}
            className="bg-black/40 border-y border-bordo py-2 text-center
                       text-sm font-bold uppercase tracking-widest opacity-90"
          >
            — {g.label} —
          </li>,
          ...g.items.map(item => renderItemRow({
            item,
            quantities,
            setQty,
            mandataAttiva,
            mandateAbilitate,
          })),
        ])}
      </ul>
    </div>
  )
}

function renderItemRow({ item, quantities, setQty, mandataAttiva, mandateAbilitate }) {
  const cur = quantities[item.id]
  const q = cur?.quantita || 0
  const mandataItem = getMandataPerItem(item)
  const isM4Forzata = item.categoria === 'cucina'
    ? mandataItem === 4
    : isBarMandata4(item)

  // L'item e' interattivo se:
  //   - la sua mandata e' abilitata (es. M4 disabilitata in "nuovo ordine")
  //   - la sua mandata coincide col tab corrente
  const mandataAbilitataPerItem = mandateAbilitate.includes(mandataItem)
  const inTabCorrente = mandataItem === mandataAttiva
  const interattivo = mandataAbilitataPerItem && inTabCorrente
  const inMandataPrecedente = mandataItem < mandataAttiva && q > 0
  const inMandataFutura = mandataItem > mandataAttiva && q > 0

  // Style:
  //   - locked M4: sfondo giallo, badge 🔒
  //   - in mandata precedente: opaco grigio
  //   - in mandata futura ma gia' selezionato: opaco diverso
  //   - normale: card neutra
  let cardClass = ''
  if (!mandataAbilitataPerItem && isM4Forzata) cardClass = 'bg-yellow-900/15 opacity-90'
  else if (!interattivo && inMandataPrecedente) cardClass = 'bg-gray-800/40 opacity-50'
  else if (!interattivo && inMandataFutura)    cardClass = 'bg-gray-800/30 opacity-60'
  else if (!interattivo)                        cardClass = 'opacity-60'

  return (
    <li key={item.id} className={`card flex items-start gap-3 ${cardClass}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold break-words whitespace-normal">{item.nome}</p>
          {!mandataAbilitataPerItem && isM4Forzata && (
            <span className="text-[10px] px-2 py-0.5 rounded-full
                             bg-yellow-900/50 border border-yellow-700 uppercase tracking-wide">
              🔒 dopo i pasti · M4
            </span>
          )}
          {q > 0 && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide
                              ${inTabCorrente
                                ? 'bg-cameriere/40 border border-cameriere'
                                : 'bg-gray-700 border border-gray-500'}`}>
              M{mandataItem}
            </span>
          )}
        </div>
        <p className="text-sm opacity-80">€ {Number(item.prezzo).toFixed(2)}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => interattivo && setQty(item, -1)}
          disabled={!interattivo || q === 0}
          className="w-11 h-11 rounded-xl bg-red-700 font-bold text-xl
                     active:scale-95 transition-transform disabled:opacity-30"
        >
          −
        </button>
        <span className="w-8 text-center text-lg font-bold">{q}</span>
        <button
          type="button"
          onClick={() => interattivo && setQty(item, +1)}
          disabled={!interattivo}
          className="w-11 h-11 rounded-xl bg-green-700 font-bold text-xl
                     active:scale-95 transition-transform disabled:opacity-30"
        >
          +
        </button>
      </div>
    </li>
  )
}
