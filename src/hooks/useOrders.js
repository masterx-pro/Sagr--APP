import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'

/**
 * useOrders: centralizza le operazioni sugli ordini.
 *
 * - fetchOpenOrders: ordini non pagati (con items)
 * - createOrder: crea ordine + righe items
 * - markItemsReady: marca pronto un set di order_items
 * - markOrderPaid: segna ordine come pagato
 * - addItemsToOrder: aggiunge altre voci a un ordine esistente
 */
export function useOrders({ autoload = false } = {}) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchOpenOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .neq('stato', 'pagato')
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
      setOrders([])
    } else {
      setOrders(data || [])
    }
    setLoading(false)
    return data || []
  }, [])

  // Tutti gli ordini pagati (cronologico crescente, vecchi → nuovi).
  // Filtro opzionale per servizio ('pranzo' | 'cena').
  const fetchPaidOrders = useCallback(async (servizio = null) => {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('stato', 'pagato')
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

  const createOrder = useCallback(async (tavolo, persone, items, note = null, extra = null) => {
    // items: [{ menuItem, quantita }]
    // extra (opzionale): { servizio, turno } — se omesso, usa i default DB
    const totale = items.reduce(
      (s, it) => s + Number(it.menuItem.prezzo) * it.quantita,
      0
    )

    const insertObj = {
      numero_tavolo: tavolo,
      n_persone: persone,
      totale,
      note,
      stato: 'pagato',
      pagato_at: new Date().toISOString()
    }
    if (extra?.servizio) insertObj.servizio = extra.servizio
    if (extra?.turno != null) insertObj.turno = extra.turno

    const { data: order, error: e1 } = await supabase
      .from('orders')
      .insert(insertObj)
      .select()
      .single()

    if (e1) throw e1

    const rows = items.map(it => ({
      order_id: order.id,
      item_id: it.menuItem.id,
      nome_item: it.menuItem.nome,
      categoria: it.menuItem.categoria,
      quantita: it.quantita,
      prezzo_unitario: it.menuItem.prezzo
    }))

    const { error: e2 } = await supabase.from('order_items').insert(rows)
    if (e2) throw e2
    return order
  }, [])

  const addItemsToOrder = useCallback(async (orderId, items) => {
    // Inserisce nuove righe e aggiorna totale
    const rows = items.map(it => ({
      order_id: orderId,
      item_id: it.menuItem.id,
      nome_item: it.menuItem.nome,
      categoria: it.menuItem.categoria,
      quantita: it.quantita,
      prezzo_unitario: it.menuItem.prezzo
    }))
    const extra = rows.reduce(
      (s, r) => s + Number(r.prezzo_unitario) * r.quantita,
      0
    )

    const { error: e1 } = await supabase.from('order_items').insert(rows)
    if (e1) throw e1

    const { data: cur, error: eRead } = await supabase
      .from('orders')
      .select('totale, stato')
      .eq('id', orderId)
      .single()
    if (eRead) throw eRead

    const newStato = cur.stato === 'pagato' ? 'pagato' : 'aperto'
    const { error: e2 } = await supabase
      .from('orders')
      .update({ totale: Number(cur.totale) + extra, stato: newStato })
      .eq('id', orderId)
    if (e2) throw e2
  }, [])

  // Marca pronti tutti gli order_items con uno specifico nome_item nella categoria,
  // per tutti gli ordini non pagati. Usato dalla vista aggregata di cucina/bar.
  const markPietanzaReady = useCallback(async (categoria, nomeItem) => {
    const { error } = await supabase
      .from('order_items')
      .update({ pronto: true })
      .eq('categoria', categoria)
      .eq('nome_item', nomeItem)
      .eq('pronto', false)
    if (error) throw error
  }, [])

  const markItemsReady = useCallback(async (orderItemIds) => {
    if (!orderItemIds || orderItemIds.length === 0) return
    const { error } = await supabase
      .from('order_items')
      .update({ pronto: true })
      .in('id', orderItemIds)
    if (error) throw error
  }, [])

  // Marca pronti tutti gli item di una categoria su un tavolo specifico
  const markTableCategoryReady = useCallback(async (orderId, categoria) => {
    const { error } = await supabase
      .from('order_items')
      .update({ pronto: true })
      .eq('order_id', orderId)
      .eq('categoria', categoria)
      .eq('pronto', false)
    if (error) throw error

    // Aggiorna stato ordine se entrambe le categorie sono complete
    const { data: items } = await supabase
      .from('order_items')
      .select('categoria, pronto')
      .eq('order_id', orderId)
    if (items) {
      const cucinaOk = items.filter(i => i.categoria === 'cucina').every(i => i.pronto)
      const barOk    = items.filter(i => i.categoria === 'bar').every(i => i.pronto)
      const hasCucina = items.some(i => i.categoria === 'cucina')
      const hasBar    = items.some(i => i.categoria === 'bar')

      let nuovoStato = 'aperto'
      if ((cucinaOk || !hasCucina) && (barOk || !hasBar)) nuovoStato = 'completo'
      else if (cucinaOk && hasCucina) nuovoStato = 'cucina_pronta'
      else if (barOk && hasBar) nuovoStato = 'bar_pronto'

      await supabase
        .from('orders')
        .update({ stato: nuovoStato })
        .eq('id', orderId)
    }
  }, [])

  const markOrderPaid = useCallback(async (orderId) => {
    const { error } = await supabase
      .from('orders')
      .update({ stato: 'pagato', pagato_at: new Date().toISOString() })
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
    if (autoload) fetchOpenOrders()
  }, [autoload, fetchOpenOrders])

  return {
    orders,
    loading,
    error,
    fetchOpenOrders,
    fetchPaidOrders,
    fetchAllOrders,
    createOrder,
    addItemsToOrder,
    markItemsReady,
    markPietanzaReady,
    markTableCategoryReady,
    markOrderPaid,
    deleteOrder,
    setOrders
  }
}
