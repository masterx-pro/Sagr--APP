import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient.js'

/**
 * MenuSelector v5: mandate libere.
 *
 * Modello dati `quantities`:
 *   { [itemId]: { 1: q1, 2: q2, 3: q3, 4: q4 } }
 * Ogni piatto puo' essere ordinato in piu' mandate contemporaneamente.
 *
 * Tab M1/M2/M3/M4: cambiano solo la VISTA. Nessun blocco.
 *   - In tab Mx la quantita' mostrata e' qty[itemId][x] (default 0)
 *   - I piatti con qty > 0 in mandate diverse da quella attiva appaiono
 *     con sfondo grigio (promemoria visivo). +/- sempre attivi.
 *
 * Props:
 *   - items, quantities, onChange
 *   - mandateAbilitate: array di tab da MOSTRARE (default [1,2,3,4])
 *     In modalita' "aggiungi M4" si puo' passare [4] per restringere.
 *   - footer: contenuto opzionale renderizzato in fondo alla lista
 *     (es. pulsante "Avanti → Pagamento" inline).
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

function qtyOf(quantities, itemId, mandata) {
  return Number(quantities?.[itemId]?.[mandata]) || 0
}
function totalQtyOf(quantities, itemId) {
  const m = quantities?.[itemId]
  if (!m) return 0
  return (m[1] || 0) + (m[2] || 0) + (m[3] || 0) + (m[4] || 0)
}

// Trasforma { itemId: {1:n,2:n,3:n,4:n} } in array di righe
// [{ itemId, mandata, quantita }] - solo quelle > 0.
export function flattenQuantities(quantities) {
  const out = []
  for (const [itemId, perMandata] of Object.entries(quantities || {})) {
    for (const [mandata, q] of Object.entries(perMandata || {})) {
      const qN = Number(q)
      if (qN > 0) {
        out.push({ itemId, mandata: parseInt(mandata, 10), quantita: qN })
      }
    }
  }
  return out
}

// Mapping mandata → target di scroll al cambio tab mandata.
//   Cucina: M1→Antipasti, M2→Primi, M3→Secondi, M4→Dolci
//   Bar:    M1→inizio lista bar (null), M4→Caffè. M2/M3: nessuno scroll.
const SCROLL_TARGET_CUCINA = { 1: 'Antipasti', 2: 'Primi', 3: 'Secondi', 4: 'Dolci' }
const SCROLL_TARGET_BAR    = { 1: null, 4: 'Caffè' }

// Altezza approx dei tab sticky (mandata + categoria) per scroll-margin-top.
const STICKY_TABS_HEIGHT_PX = 110

export default function MenuSelector({
  items,
  quantities,
  onChange,
  mandateAbilitate = [1, 2, 3, 4],
  footer = null,
  // Offset in px da viewport-top per stickare i tab sotto un header esterno
  // (es. RoleHeader sticky). 0 = stick al top del viewport.
  stickyTop = 0,
}) {
  const [mandataAttiva, setMandataAttiva] = useState(mandateAbilitate[0] ?? 1)
  const [tab, setTab] = useState('cucina')

  // Refs ai separatori di sezione (— ANTIPASTI —, — PRIMI —, ecc).
  // Vengono ricostruiti al cambio tab perche' le sezioni cambiano.
  const sectionRefs = useRef({})
  const listRef = useRef(null)
  useEffect(() => { sectionRefs.current = {} }, [tab])

  // Stock realtime: ascolta UPDATE su menu_items per aggiornare i badge
  // "N rimaste" senza ricaricare il menu. Mantiene una mappa locale
  // override { itemId: porzioni_disponibili } che ha priorita' sui prop.
  const [stockOverride, setStockOverride] = useState({})
  useEffect(() => {
    const ch = supabase
      .channel('menu-items-stock')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'menu_items' },
        (payload) => {
          const r = payload?.new
          if (!r?.id) return
          setStockOverride(s => ({
            ...s,
            [r.id]: {
              porzioni_disponibili: r.porzioni_disponibili,
              soglia_alert: r.soglia_alert,
              traccia_magazzino: r.traccia_magazzino,
            },
          }))
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // Items mescolando i valori prop con l'override realtime
  const itemsAttivi = useMemo(() => {
    return (items || [])
      .filter(i => i.attivo !== false)
      .map(i => {
        const ov = stockOverride[i.id]
        if (!ov) return i
        return {
          ...i,
          porzioni_disponibili: ov.porzioni_disponibili,
          soglia_alert: ov.soglia_alert ?? i.soglia_alert,
          traccia_magazzino: ov.traccia_magazzino,
        }
      })
  }, [items, stockOverride])

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

  // Conteggio pezzi PER MANDATA (tutte le mandate, tutte le categorie)
  const contoPerMandata = useMemo(() => {
    const tot = { 1: 0, 2: 0, 3: 0, 4: 0 }
    for (const perMandata of Object.values(quantities || {})) {
      for (const m of [1, 2, 3, 4]) {
        tot[m] += Number(perMandata?.[m] || 0)
      }
    }
    return tot
  }, [quantities])

  const setQty = (item, delta) => {
    const cur = qtyOf(quantities, item.id, mandataAttiva)
    const next = Math.max(0, cur + delta)
    const updated = { ...quantities }
    const perMandataExisting = updated[item.id] ? { ...updated[item.id] } : {}
    if (next === 0) delete perMandataExisting[mandataAttiva]
    else perMandataExisting[mandataAttiva] = next
    if (Object.keys(perMandataExisting).length === 0) delete updated[item.id]
    else updated[item.id] = perMandataExisting
    onChange(updated)
  }

  const scrollToTarget = (target) => {
    // target === null → inizio lista (listRef); stringa → ref del separatore.
    const el = target === null ? listRef.current : sectionRefs.current[target]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleMandataClick = (n) => {
    setMandataAttiva(n)
    const map = tab === 'cucina' ? SCROLL_TARGET_CUCINA : SCROLL_TARGET_BAR
    if (!(n in map)) return // mandata senza target di scroll
    requestAnimationFrame(() => scrollToTarget(map[n]))
  }

  const sezioneScrollMarginTop = `${stickyTop + STICKY_TABS_HEIGHT_PX}px`

  return (
    <div>
      {/* Tab mandata + categoria: unico contenitore sticky sotto l'header */}
      <div
        className="sticky z-20 bg-sfondo -mx-4 px-4 pt-2 pb-2 mb-3 border-b border-borderSoft"
        style={{ top: stickyTop }}
      >
        <div className="flex gap-2 mb-2">
          {[1, 2, 3, 4].map(n => {
            const active = mandataAttiva === n
            const count = contoPerMandata[n]
            const hidden = !mandateAbilitate.includes(n)
            if (hidden) return null
            return (
              <button
                key={n}
                type="button"
                onClick={() => handleMandataClick(n)}
                className={`flex-1 min-h-btn rounded-xl font-bold text-sm relative
                            ${active ? 'bg-cameriere text-white' : 'bg-pannello border border-bordo'}`}
              >
                M{n}
                {count > 0 && (
                  <span className="ml-1 text-xs font-normal opacity-90">· {count}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex gap-2">
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
      </div>

      <ul
        ref={listRef}
        style={{ scrollMarginTop: sezioneScrollMarginTop }}
        className="space-y-2"
      >
        {itemsCategoria.length === 0 && (
          <li className="text-center opacity-60 py-6">
            Nessuna voce disponibile
          </li>
        )}
        {grouped.flatMap(g => [
          <li
            key={`hdr-${g.label}`}
            ref={el => { if (el) sectionRefs.current[g.label] = el }}
            style={{ scrollMarginTop: sezioneScrollMarginTop }}
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
          })),
        ])}
      </ul>

      {/* Footer inline (pulsante pagamento o azione) */}
      {footer && (
        <div className="mt-6">
          {footer}
        </div>
      )}
    </div>
  )
}

// Calcola info magazzino: { esaurito, alertCls, label } o null se non tracciato.
function stockInfo(item, qNow, qTotale) {
  if (!item?.traccia_magazzino) return null
  const disp = Number(item.porzioni_disponibili ?? 0)
  const soglia = Number(item.soglia_alert ?? 0)
  // Quanti pezzi sono GIA' nel carrello: il calcolo "esaurito" tiene conto
  // della quantita' che sto per ordinare, non solo del DB.
  const inCarrello = Number(qTotale || 0)
  const restanti = Math.max(0, disp - inCarrello)
  if (disp === 0) {
    return { esaurito: true, restanti: 0, alertCls: 'bg-danger text-bg', label: 'ESAURITO' }
  }
  if (disp <= Math.max(1, Math.floor(soglia / 2))) {
    return { esaurito: false, restanti, alertCls: 'bg-dangerSoft text-danger border border-danger/40',
             label: `🔴 ${restanti} rimaste` }
  }
  if (disp <= soglia) {
    return { esaurito: false, restanti, alertCls: 'bg-warningSoft text-warning border border-warning/40',
             label: `⚠️ ${restanti} rimaste` }
  }
  return null
}

function renderItemRow({ item, quantities, setQty, mandataAttiva }) {
  const qNow = qtyOf(quantities, item.id, mandataAttiva)
  const qTotale = totalQtyOf(quantities, item.id)
  // E' "in altre mandate" se ha quantita' > 0 ma NON nella mandata corrente
  const inAltreMandate = qNow === 0 && qTotale > 0
  // Sfondo grigio se compare in altre mandate; sfondo normale altrimenti
  const cardClass = inAltreMandate ? 'bg-surfaceElev/60' : ''

  const stock = stockInfo(item, qNow, qTotale)
  const esaurito = stock?.esaurito && qNow === 0
  // Disabilita "+" anche se aggiungere supererebbe le porzioni disponibili
  const plusDisabled = stock?.esaurito || (stock && stock.restanti <= 0)

  return (
    <li key={item.id} className={`card flex items-start gap-3 ${cardClass} ${esaurito ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold break-words whitespace-normal">{item.nome}</p>
          {stock && (
            <span className={`pill text-[10.5px] tabular-nums ${stock.alertCls}`}>
              {stock.label}
            </span>
          )}
          {qNow > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide
                             bg-wineSoft border border-wine/40">
              M{mandataAttiva}
            </span>
          )}
          {inAltreMandate && (
            <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide
                             bg-surfaceElev border border-borderSoft text-textSoft opacity-80"
                  title="Già selezionato in altre mandate">
              anche in altre M
            </span>
          )}
        </div>
        <p className="text-sm text-textSoft">€ {Number(item.prezzo).toFixed(2)}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setQty(item, -1)}
          disabled={qNow === 0}
          className="w-11 h-11 rounded-xl bg-danger font-bold text-xl text-text
                     active:scale-95 transition-transform disabled:opacity-30"
        >
          −
        </button>
        <span className="w-8 text-center text-lg font-bold tabular-nums">{qNow}</span>
        <button
          type="button"
          onClick={() => setQty(item, +1)}
          disabled={plusDisabled}
          className="w-11 h-11 rounded-xl bg-success font-bold text-xl text-text
                     active:scale-95 transition-transform disabled:opacity-30"
        >
          +
        </button>
      </div>
    </li>
  )
}
