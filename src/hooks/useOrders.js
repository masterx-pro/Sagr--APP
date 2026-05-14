import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { getMandataPerItem } from '../utils/servizio.js'

/**
 * useOrders v2: data layer per il modello nuovo.
 *
 * Stati ordine:
 *   'bozza'        creato ma senza pagamento scelto
 *   'attesa_cassa' cameriere ha scelto contanti, in coda alla cassa
 *   'confermato'   pagato (bancomat o contanti) -> attivo in cucina/bar
 *   'stornato'     in pausa, attende ri-conferma cassa
 *   'completato'   tutto consegnato e chiuso
 *
 * Le voci dell'ordine hanno:
 *   mandata        (1, 2, 3, ...)
 *   mandata_stato  ('in_attesa'|'in_preparazione'|'pronta'|'consegnata'|'in_pausa')
 *
 * NB: il vecchio campo `pronto` resta in DB per compatibilita' storica
 *     ma il codice v2 NON lo tocca piu'.
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
  //   pagamento: 'bancomat' | 'contanti' | undefined
  //          'bancomat'  -> stato 'confermato' (gia' incassato)
  //          'contanti'  -> stato 'attesa_cassa'
  //          undefined   -> stato 'bozza'
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
      stato = 'bozza'
      tipo_pagamento = null
      pagato_at = null
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
  }, [])

  // -----------------------------------------------------------
  // MANDATE — flusso cucina/bar
  // -----------------------------------------------------------

  // Step 1 del flusso progressivo cucina/bar: items passano da
  // 'in_attesa' a 'in_preparazione'. Filtra per categoria.
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
      .eq('mandata_stato', 'in_attesa')
    if (error) throw error
  }, [])

  // Step 2 del flusso progressivo: items passano a 'pronta' e parte il
  // timer per la mandata successiva.
  const markMandataReady = useCallback(async (orderId, mandataNum, categoria) => {
    const { error } = await supabase
      .from('order_items')
      .update({
        mandata_stato: 'pronta',
        mandata_pronta_at: new Date().toISOString(),
      })
      .eq('order_id', orderId)
      .eq('mandata', mandataNum)
      .eq('categoria', categoria)
      .in('mandata_stato', ['in_attesa', 'in_preparazione'])
    if (error) throw error
  }, [])

  // Cameriere conferma la consegna al tavolo: la mandata esce dal flusso attivo.
  const markMandataConsegnata = useCallback(async (orderId, mandataNum, categoria = null) => {
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
  }, [])

  // Cameriere "Invia M4": tutti gli items in mandata 4 (dolci + caffe'
  // + amari) passano da in_attesa a in_preparazione e diventano subito
  // visibili al bar (in v5 anche i dolci finiscono al bar quando M4).
  const inviaM4 = useCallback(async (orderId) => {
    const { error } = await supabase
      .from('order_items')
      .update({
        mandata_stato: 'in_preparazione',
        mandata_inviata_at: new Date().toISOString(),
      })
      .eq('order_id', orderId)
      .eq('mandata', 4)
      .eq('mandata_stato', 'in_attesa')
    if (error) throw error
  }, [])

  // Alias retro-compat v2/v3
  const sbloccaMandata4    = inviaM4
  const sbloccaBarMandata2 = inviaM4

  // -----------------------------------------------------------
  // PAGAMENTI — storno / conferma cassa
  // -----------------------------------------------------------

  // Storna un ordine confermato. Tutto cio' che non e' gia' stato
  // consegnato va in pausa (badge IN PAUSA in cucina/bar).
  //   tipoPagamentoOverride: se passato, sostituisce tipo_pagamento.
  //     Es. ordine bancomat -> "passa a contanti" => storna + setta 'contanti'.
  const stornaOrdine = useCallback(async (orderId, note = null, tipoPagamentoOverride = null) => {
    const patch = {
      stato: 'stornato',
      stornato_at: new Date().toISOString(),
      storno_note: note,
    }
    if (tipoPagamentoOverride) patch.tipo_pagamento = tipoPagamentoOverride

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
    // mandate
    markMandataInPreparazione,
    markMandataReady,
    markMandataConsegnata,
    inviaM4,
    sbloccaMandata4,     // alias retro-compat v3
    sbloccaBarMandata2,  // alias retro-compat v2
    // pagamenti
    stornaOrdine,
    confermaPagamentoCassa,
    // utility
    completaOrdine,
    deleteOrder,
    setOrders,
  }
}
