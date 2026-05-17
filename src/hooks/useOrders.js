import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { getMandataPerItem, getTimerPreRiscaldo } from '../utils/servizio.js'
import { getPortataDominante } from '../utils/mandateUtils.js'

/**
 * useOrders v5: data layer per il modello con sblocco mandate + KDS.
 *
 * Stati ordine:
 *   'bozza'        creato ma senza pagamento scelto
 *   'attesa_cassa' cameriere ha scelto contanti, in coda alla cassa
 *   'confermato'   pagato (bancomat o contanti) -> attivo in cucina/bar
 *   'stornato'     in pausa, attende ri-conferma cassa
 *   'completato'   tutto consegnato e chiuso
 *
 * Stati mandata (per order_items.mandata_stato, v5):
 *   'in_attesa'       ordine ricevuto, nessuna azione
 *   'pre_riscaldo'    timer scattato, cucina inizia a riscaldare
 *   'sbloccata'       cameriere ha premuto "Esci con MN" (urgente)
 *   'in_preparazione' cucina/bar ha preso in carico
 *   'in_finestra'     pronto in finestra, attende cameriere
 *   'consegnata'      cameriere ha portato al tavolo
 *   'in_pausa'        ordine stornato
 *
 * NB: il vecchio campo `pronto` resta in DB per compatibilita' storica;
 *     v5 non lo tocca piu'.
 *     `pronta` (legacy v2-v4) e' stato migrato a `in_finestra` in v5.
 */
export function useOrders({ autoload = false } = {}) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // -----------------------------------------------------------
  // FETCHERS
  // -----------------------------------------------------------

  // Ordini attivi per cameriere/stazioni:
  //   stato IN ('attesa_cassa','confermato','stornato')
  // Filtro opzionale per servizio ('pranzo'|'cena').
  const fetchOrdiniAttivi = useCallback(async (servizio = null) => {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('orders')
      .select('*, order_items(*)')
      .in('stato', ['attesa_cassa', 'confermato', 'stornato'])
      .order('created_at', { ascending: true })
    if (servizio) q = q.eq('servizio', servizio)
    const { data, error } = await q
    if (error) {
      setError(error.message)
      setOrders([])
    } else {
      setOrders(data || [])
    }
    setLoading(false)
    return data || []
  }, [])

  // Coda cassa: ordini da incassare (contanti pending) o da ri-confermare (storni).
  const fetchCassaQueue = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .in('stato', ['attesa_cassa', 'stornato'])
      .order('created_at', { ascending: true })
    if (error) {
      setError(error.message)
      setOrders([])
    } else {
      setOrders(data || [])
    }
    setLoading(false)
    return data || []
  }, [])

  // Tutti gli ordini (per admin).
  const fetchAllOrders = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setOrders(data || [])
    setLoading(false)
    return data || []
  }, [])

  // Mappa { chiave: valore } letta dalla tabella impostazioni.
  const fetchImpostazioni = useCallback(async () => {
    const { data, error } = await supabase
      .from('impostazioni')
      .select('chiave, valore')
    if (error) throw error
    const map = {}
    for (const row of data || []) map[row.chiave] = row.valore
    return map
  }, [])

  const saveImpostazione = useCallback(async (chiave, valore) => {
    // UPSERT: crea la riga se non esiste, altrimenti aggiorna.
    // Robusto anche se la migration non e' stata eseguita (le chiavi
    // nuove vengono create al primo salvataggio dall'admin).
    const { error } = await supabase
      .from('impostazioni')
      .upsert(
        { chiave, valore: String(valore), updated_at: new Date().toISOString() },
        { onConflict: 'chiave' }
      )
    if (error) throw error
  }, [])

  // -----------------------------------------------------------
  // CREATE / ADD
  // -----------------------------------------------------------

  // Crea un nuovo ordine.
  //   items: [{ menuItem, quantita, mandata? }]
  //          mandata default = 1; per voci bar caffe'/amari (ordine>=40)
  //          viene forzata a 2 ignorando il parametro.
  //   pagamento: 'bancomat' | 'contanti'
  //          'bancomat'  -> stato 'confermato' (gia' incassato)
  //          'contanti'  -> stato 'attesa_cassa'
  const createOrder = useCallback(async ({
    tavolo,
    persone,
    nomeCliente,
    items,
    pagamento,
    note = null,
    servizio = null,
    cameriereNome = null,
    cameriereId = null,
  }) => {
    if (!items || items.length === 0) {
      throw new Error('Impossibile creare un ordine senza voci')
    }
    if (!nomeCliente || !String(nomeCliente).trim()) {
      throw new Error('Nome cliente obbligatorio')
    }

    const totale = items.reduce(
      (s, it) => s + Number(it.menuItem.prezzo) * it.quantita,
      0
    )

    let stato, tipo_pagamento, pagato_at
    if (pagamento === 'bancomat') {
      stato = 'confermato'
      tipo_pagamento = 'bancomat'
      pagato_at = new Date().toISOString()
    } else if (pagamento === 'contanti') {
      stato = 'attesa_cassa'
      tipo_pagamento = 'contanti'
      pagato_at = null
    } else {
      throw new Error('Pagamento obbligatorio: bancomat o contanti')
    }

    const insertObj = {
      numero_tavolo: tavolo,
      n_persone: persone,
      nome_cliente: String(nomeCliente).trim(),
      totale,
      note,
      stato,
      tipo_pagamento,
      servizio,
      cameriere_nome: cameriereNome,
      cameriere_id: cameriereId,
    }
    if (pagato_at) insertObj.pagato_at = pagato_at

    const { data: order, error: e1 } = await supabase
      .from('orders')
      .insert(insertObj)
      .select()
      .single()
    if (e1) throw e1

    const rows = items.map(it => {
      // In v5 la mandata e' ESPLICITA: il chiamante decide a quale
      // mandata appartiene ogni riga. Fallback alla derivazione per
      // sottocategoria solo se la riga non specifica `mandata`.
      const mandata = it.mandata ?? getMandataPerItem(it.menuItem)
      return {
        order_id: order.id,
        item_id: it.menuItem.id,
        nome_item: it.menuItem.nome,
        categoria: it.menuItem.categoria,
        quantita: it.quantita,
        prezzo_unitario: it.menuItem.prezzo,
        mandata,
        mandata_stato: 'in_attesa',
      }
    })

    const { error: e2 } = await supabase.from('order_items').insert(rows)
    if (e2) throw e2

    // Decrementa porzioni_disponibili per i menu_items con traccia_magazzino.
    // Fallisce silenziosamente: lo stock e' best-effort, l'ordine resta valido.
    await decrementaPorzioni(items).catch(e =>
      console.warn('Errore decremento porzioni:', e?.message || e)
    )

    return order
  }, [])

  // Aggiunge righe a un ordine esistente. Lo stato dell'ordine non cambia.
  //   items:   [{ menuItem, quantita }]
  //   options: { statoIniziale?: 'in_attesa'|'in_preparazione'|'in_pausa' }
  // Se l'ordine e' 'stornato' i nuovi item nascono in_pausa.
  // Se viene passato statoIniziale lo si usa (utile per "Sblocca M4" che
  // crea direttamente items in 'in_preparazione', cosi' che cucina/bar
  // li vedano subito attivi).
  const addItemsToOrder = useCallback(async (orderId, items, options = {}) => {
    if (!items || items.length === 0) return

    const { data: cur, error: eRead } = await supabase
      .from('orders')
      .select('totale, stato')
      .eq('id', orderId)
      .single()
    if (eRead) throw eRead

    let initialMandataStato
    if (cur.stato === 'stornato')          initialMandataStato = 'in_pausa'
    else if (options.statoIniziale)        initialMandataStato = options.statoIniziale
    else                                    initialMandataStato = 'in_attesa'

    const rows = items.map(it => {
      const mandata = it.mandata ?? getMandataPerItem(it.menuItem)
      return {
        order_id: orderId,
        item_id: it.menuItem.id,
        nome_item: it.menuItem.nome,
        categoria: it.menuItem.categoria,
        quantita: it.quantita,
        prezzo_unitario: it.menuItem.prezzo,
        mandata,
        mandata_stato: initialMandataStato,
      }
    })
    const extra = rows.reduce(
      (s, r) => s + Number(r.prezzo_unitario) * r.quantita,
      0
    )

    const { error: e1 } = await supabase.from('order_items').insert(rows)
    if (e1) throw e1

    const { error: e2 } = await supabase
      .from('orders')
      .update({ totale: Number(cur.totale) + extra })
      .eq('id', orderId)
    if (e2) throw e2

    // Decrementa stock anche per i riordini (eccetto se ordine in pausa).
    if (cur.stato !== 'stornato') {
      await decrementaPorzioni(items).catch(e =>
        console.warn('Errore decremento porzioni (riordino):', e?.message || e)
      )
    }
  }, [])

  // -----------------------------------------------------------
  // MANDATE — flusso v5 (sblocco / preparazione / finestra / consegna)
  // -----------------------------------------------------------

  // CAMERIERE — "Esci con MN": la mandata diventa URGENTE per la cucina.
  // Sposta da {in_attesa | pre_riscaldo} -> 'sbloccata' tutti gli items
  // cucina della mandata. Non tocca items gia' in_preparazione/in_finestra/
  // consegnata. Se mandataNum===4 sblocca anche il bar (caffe'/amari).
  const sbloccaMandata = useCallback(async (orderId, mandataNum) => {
    const now = new Date().toISOString()

    // Categorie target: M4 -> cucina + bar (caffè/amari). Altre mandate -> solo cucina.
    const categorie = mandataNum === 4 ? ['cucina', 'bar'] : ['cucina']

    const { error } = await supabase
      .from('order_items')
      .update({
        mandata_stato: 'sbloccata',
        sbloccata_at: now,
        mandata_inviata_at: now,
      })
      .eq('order_id', orderId)
      .eq('mandata', mandataNum)
      .in('categoria', categorie)
      .in('mandata_stato', ['in_attesa', 'pre_riscaldo'])
    if (error) throw error
  }, [])

  // CUCINA/BAR — Step 1: prende in carico la mandata.
  // Accetta items in {in_attesa, pre_riscaldo, sbloccata}.
  const markMandataInPreparazione = useCallback(async (orderId, mandataNum, categoria) => {
    const { error } = await supabase
      .from('order_items')
      .update({
        mandata_stato: 'in_preparazione',
        mandata_inviata_at: new Date().toISOString(),
      })
      .eq('order_id', orderId)
      .eq('mandata', mandataNum)
      .eq('categoria', categoria)
      .in('mandata_stato', ['in_attesa', 'pre_riscaldo', 'sbloccata'])
    if (error) throw error
  }, [])

  // CUCINA/BAR — Step 2: la mandata e' pronta in finestra, attende il
  // cameriere. Triggera il banner "🪟 in finestra" lato sala.
  // Compat: vecchio `markMandataReady` → ora alias di marcaInFinestra.
  const marcaInFinestra = useCallback(async (orderId, mandataNum, categoria) => {
    const { error } = await supabase
      .from('order_items')
      .update({
        mandata_stato: 'in_finestra',
        in_finestra_at: new Date().toISOString(),
        // mandata_pronta_at scritto in parallelo per compat con codice
        // che ancora legge il vecchio campo (CassaPage, dettaglio storno).
        mandata_pronta_at: new Date().toISOString(),
      })
      .eq('order_id', orderId)
      .eq('mandata', mandataNum)
      .eq('categoria', categoria)
      .in('mandata_stato', ['in_attesa', 'pre_riscaldo', 'sbloccata', 'in_preparazione'])
    if (error) throw error
  }, [])
  const markMandataReady = marcaInFinestra // alias compat

  // CAMERIERE — Step 3: ha portato la mandata al tavolo.
  // Effetto collaterale: se la mandata e' cucina, calcola il timer
  // pre-riscaldo della mandata successiva (in base alla portata dominante
  // della M(N+1)) e la promuove da in_attesa -> pre_riscaldo con
  // pre_riscaldo_at = now() + timer_minuti.
  const marcaConsegnata = useCallback(async (orderId, mandataNum, categoria = null) => {
    let q = supabase
      .from('order_items')
      .update({
        mandata_stato: 'consegnata',
        mandata_consegnata_at: new Date().toISOString(),
      })
      .eq('order_id', orderId)
      .eq('mandata', mandataNum)
      .neq('mandata_stato', 'consegnata')
    if (categoria) q = q.eq('categoria', categoria)
    const { error } = await q
    if (error) throw error

    // Promozione pre-riscaldo della mandata successiva (solo cucina).
    if (categoria === null || categoria === 'cucina') {
      await promuoviPreRiscaldoSuccessiva(orderId, mandataNum).catch(e =>
        console.warn('Pre-riscaldo promozione fallita:', e?.message || e)
      )
    }
  }, [])
  const markMandataConsegnata = marcaConsegnata // alias compat

  // CAMERIERE — "Sblocca M4": tutti gli items in mandata 4 (dolci + caffe'
  // + amari) passano da in_attesa a sbloccata; il bar li vede URGENTI.
  // Equivalente a sbloccaMandata(orderId, 4) — mantenuto come funzione
  // dedicata per chiarezza nella UI.
  const inviaM4 = useCallback(async (orderId) => {
    return sbloccaMandata(orderId, 4)
  }, [sbloccaMandata])

  // -----------------------------------------------------------
  // PAGAMENTI — storno / conferma cassa
  // -----------------------------------------------------------

  // Storna un ordine confermato. Tutto cio' che non e' gia' stato
  // consegnato va in pausa (badge IN PAUSA in cucina/bar).
  //   tipoPagamentoOverride: se passato, sostituisce tipo_pagamento.
  //     Es. ordine bancomat -> "passa a contanti" => storna + setta 'contanti'.
  // Effetto magazzino: per i piatti con traccia_magazzino=true, le
  // porzioni vengono RIPRISTINATE (porzioni_disponibili += quantita)
  // proporzionalmente agli items non consegnati (i consegnati restano scalati).
  const stornaOrdine = useCallback(async (orderId, note = null, tipoPagamentoOverride = null) => {
    const patch = {
      stato: 'stornato',
      stornato_at: new Date().toISOString(),
      storno_note: note,
    }
    if (tipoPagamentoOverride) patch.tipo_pagamento = tipoPagamentoOverride

    // Leggi PRIMA gli items che andranno in pausa per ripristinare lo stock
    const { data: itemsDaRipristinare } = await supabase
      .from('order_items')
      .select('item_id, quantita')
      .eq('order_id', orderId)
      .neq('mandata_stato', 'consegnata')

    const { error: e1 } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', orderId)
    if (e1) throw e1

    const { error: e2 } = await supabase
      .from('order_items')
      .update({ mandata_stato: 'in_pausa' })
      .eq('order_id', orderId)
      .neq('mandata_stato', 'consegnata')
    if (e2) throw e2

    // Ripristino magazzino (best-effort, non blocca lo storno)
    if (itemsDaRipristinare && itemsDaRipristinare.length > 0) {
      await ripristinaPorzioni(itemsDaRipristinare).catch(e =>
        console.warn('Ripristino porzioni fallito:', e?.message || e)
      )
    }
  }, [])

  // Cassa incassa un ordine in 'attesa_cassa' o 'stornato':
  //   stato -> 'confermato'
  //   items in_pausa -> in_attesa (rientrano in coda cucina/bar)
  const confermaPagamentoCassa = useCallback(async (orderId, tipoPagamento = 'contanti') => {
    const { error: e1 } = await supabase
      .from('orders')
      .update({
        stato: 'confermato',
        tipo_pagamento: tipoPagamento,
        pagato_at: new Date().toISOString(),
        stornato_at: null,
      })
      .eq('id', orderId)
    if (e1) throw e1

    const { error: e2 } = await supabase
      .from('order_items')
      .update({ mandata_stato: 'in_attesa' })
      .eq('order_id', orderId)
      .eq('mandata_stato', 'in_pausa')
    if (e2) throw e2
  }, [])

  // -----------------------------------------------------------
  // MAGAZZINO PORZIONI
  // -----------------------------------------------------------

  // Tutti i menu_items in alert (porzioni_disponibili <= soglia_alert).
  // Solo voci con traccia_magazzino=true e attive.
  const fetchMagazzinoAlert = useCallback(async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, nome, categoria, sottocategoria, porzioni_totali, porzioni_disponibili, soglia_alert, traccia_magazzino, attivo')
      .eq('traccia_magazzino', true)
      .eq('attivo', true)
    if (error) throw error
    // Filtra client-side: la condizione `porzioni_disponibili <= soglia_alert`
    // non esprimibile come filtro Supabase fra due colonne.
    return (data || []).filter(it => {
      const disp = it.porzioni_disponibili
      const soglia = it.soglia_alert ?? 0
      return disp != null && disp <= soglia
    })
  }, [])

  // Aggiorna manualmente le porzioni disponibili per un item del menu.
  // Imposta anche porzioni_totali se passato (utile per "ricarico").
  const updatePorzioni = useCallback(async (itemId, quantita, opts = {}) => {
    const patch = { porzioni_disponibili: Math.max(0, Number(quantita) | 0) }
    if (opts.porzioniTotali != null) patch.porzioni_totali = Math.max(0, Number(opts.porzioniTotali) | 0)
    const { error } = await supabase
      .from('menu_items')
      .update(patch)
      .eq('id', itemId)
    if (error) throw error
  }, [])

  // -----------------------------------------------------------
  // CHIUSURA & UTILS
  // -----------------------------------------------------------

  const completaOrdine = useCallback(async (orderId) => {
    const { error } = await supabase
      .from('orders')
      .update({ stato: 'completato' })
      .eq('id', orderId)
    if (error) throw error
  }, [])

  const deleteOrder = useCallback(async (orderId) => {
    const { error } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderId)
    if (error) throw error
  }, [])

  useEffect(() => {
    if (autoload) fetchOrdiniAttivi()
  }, [autoload, fetchOrdiniAttivi])

  return {
    orders,
    loading,
    error,
    // fetchers
    fetchOrdiniAttivi,
    fetchCassaQueue,
    fetchAllOrders,
    fetchImpostazioni,
    saveImpostazione,
    // mutazioni ordini
    createOrder,
    addItemsToOrder,
    // mandate v5
    sbloccaMandata,
    marcaInFinestra,
    marcaConsegnata,
    // mandate legacy aliases (per chiamanti non ancora migrati)
    markMandataInPreparazione,
    markMandataReady,
    markMandataConsegnata,
    inviaM4,
    // pagamenti
    stornaOrdine,
    confermaPagamentoCassa,
    // magazzino
    fetchMagazzinoAlert,
    updatePorzioni,
    // utility
    completaOrdine,
    deleteOrder,
  }
}

// =============================================================
// HELPERS PRIVATI (fuori dall'hook per evitare re-render)
// =============================================================

// Decrementa porzioni_disponibili per gli items con traccia_magazzino.
// items: [{ menuItem, quantita }]
async function decrementaPorzioni(items) {
  for (const it of items) {
    const mi = it.menuItem
    if (!mi || mi.traccia_magazzino !== true) continue
    if (mi.porzioni_disponibili == null) continue
    const nuova = Math.max(0, Number(mi.porzioni_disponibili) - Number(it.quantita || 0))
    const { error } = await supabase
      .from('menu_items')
      .update({ porzioni_disponibili: nuova })
      .eq('id', mi.id)
    if (error) {
      console.warn('decrementaPorzioni error', mi.id, error.message)
    }
  }
}

// Ripristina porzioni_disponibili per gli items rimborsati/stornati.
// items: [{ item_id, quantita }]
async function ripristinaPorzioni(items) {
  // Aggrega per item_id (in caso di items duplicati nell'ordine).
  const aggr = new Map()
  for (const it of items) {
    if (!it.item_id) continue
    aggr.set(it.item_id, (aggr.get(it.item_id) || 0) + Number(it.quantita || 0))
  }
  if (aggr.size === 0) return

  // Carica solo le righe con tracking attivo per evitare update inutili
  const ids = Array.from(aggr.keys())
  const { data: rows } = await supabase
    .from('menu_items')
    .select('id, porzioni_disponibili, traccia_magazzino')
    .in('id', ids)
    .eq('traccia_magazzino', true)
  for (const r of rows || []) {
    const incr = aggr.get(r.id) || 0
    const cur = Number(r.porzioni_disponibili ?? 0)
    const { error } = await supabase
      .from('menu_items')
      .update({ porzioni_disponibili: cur + incr })
      .eq('id', r.id)
    if (error) console.warn('ripristinaPorzioni error', r.id, error.message)
  }
}

// Promuove gli items cucina della mandata SUCCESSIVA da in_attesa →
// pre_riscaldo. pre_riscaldo_at = now() + getTimerPreRiscaldo(portata).
// La portata usata e' la dominante della M(N+1).
async function promuoviPreRiscaldoSuccessiva(orderId, mandataConsegnata) {
  const next = Number(mandataConsegnata) + 1
  if (next > 4) return // non c'e' una M5

  // Verifica che M(N) sia davvero tutta consegnata in cucina prima di
  // promuovere — proteggono il polling-on-consegna da chiamate parziali.
  const { data: prev } = await supabase
    .from('order_items')
    .select('mandata_stato')
    .eq('order_id', orderId)
    .eq('mandata', mandataConsegnata)
    .eq('categoria', 'cucina')
  if (!prev || prev.length === 0) return
  const tuttaConsegnata = prev.every(i => i.mandata_stato === 'consegnata')
  if (!tuttaConsegnata) return

  // Carica items della successiva (cucina) ancora in_attesa
  const { data: nextItems } = await supabase
    .from('order_items')
    .select('id, mandata_stato, ordine:item_id ( ordine ), menu_items ( ordine )')
    .eq('order_id', orderId)
    .eq('mandata', next)
    .eq('categoria', 'cucina')
    .eq('mandata_stato', 'in_attesa')
  if (!nextItems || nextItems.length === 0) return

  // Carica impostazioni per il timer
  const { data: settingsRows } = await supabase
    .from('impostazioni')
    .select('chiave, valore')
    .like('chiave', 'pre_riscaldo_%_min')
  const impostazioni = {}
  for (const r of settingsRows || []) impostazioni[r.chiave] = r.valore

  // Portata dominante della successiva (servono item.ordine)
  const itemsConOrdine = nextItems.map(i => ({
    categoria: 'cucina',
    ordine: i.menu_items?.ordine ?? 0,
  }))
  const portata = getPortataDominante(itemsConOrdine, impostazioni) || 'primo'
  const timerMin = getTimerPreRiscaldo(portata, impostazioni)
  const scadenza = new Date(Date.now() + timerMin * 60_000).toISOString()

  const ids = nextItems.map(i => i.id)
  const { error } = await supabase
    .from('order_items')
    .update({ mandata_stato: 'pre_riscaldo', pre_riscaldo_at: scadenza })
    .in('id', ids)
  if (error) console.warn('promuoviPreRiscaldoSuccessiva', orderId, next, error.message)
}
