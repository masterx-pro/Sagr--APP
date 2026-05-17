// Test end-to-end del flusso pagamento v6:
//   - bancomat: createOrder -> attesa_bancomat -> confermaPagamentoBancomat -> confermato + M1 sbloccata
//   - contanti: createOrder -> attesa_cassa     -> confermaPagamentoCassa    -> confermato + M1 sbloccata
//   - constraint DB: stato invalido viene rifiutato
//
// Non usa Playwright: parla direttamente con Supabase via REST (stessa
// API che usa il frontend tramite useOrders.js).
//
// Lancia:  node tests/test-flusso-pagamento.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf-8')
  .split('\n').filter(Boolean)
  .reduce((acc, l) => { const [k,v] = l.split('='); acc[k] = v; return acc }, {})

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const created = [] // ordini creati, da pulire al termine

function fail(msg) { console.error('  ✗', msg); process.exitCode = 1 }
function pass(msg) { console.log('  ✓', msg) }

async function pickMenuItems() {
  const { data } = await sb.from('menu_items')
    .select('id, nome, categoria, prezzo').eq('attivo', true)
  if (!data?.length) throw new Error('menu vuoto')
  const bar    = data.find(x => x.categoria === 'bar')
  const cucina = data.find(x => x.categoria === 'cucina')
  if (!bar || !cucina) throw new Error('manca un item bar o cucina')
  return { bar, cucina }
}

async function createOrder({ tavolo, pagamento, items, nomeCliente = 'TEST' }) {
  const totale = items.reduce((s, it) => s + Number(it.menuItem.prezzo) * it.quantita, 0)
  const stato =
    pagamento === 'bancomat' ? 'attesa_bancomat' :
    pagamento === 'contanti' ? 'attesa_cassa'    : null
  if (!stato) throw new Error('pagamento sconosciuto')

  const { data: order, error: e1 } = await sb.from('orders').insert({
    numero_tavolo: tavolo,
    n_persone: 1,
    nome_cliente: nomeCliente,
    totale,
    stato,
    tipo_pagamento: pagamento,
  }).select().single()
  if (e1) throw e1
  created.push(order.id)

  const rows = items.map(it => ({
    order_id: order.id,
    item_id: it.menuItem.id,
    nome_item: it.menuItem.nome,
    categoria: it.menuItem.categoria,
    quantita: it.quantita,
    prezzo_unitario: it.menuItem.prezzo,
    mandata: it.mandata,
    mandata_stato: 'in_attesa',
  }))
  const { error: e2 } = await sb.from('order_items').insert(rows)
  if (e2) throw e2
  return order
}

async function confermaPagamentoBancomat(orderId) {
  const { error: e1 } = await sb.from('orders').update({
    stato: 'confermato',
    pagato_at: new Date().toISOString(),
  }).eq('id', orderId).eq('stato', 'attesa_bancomat')
  if (e1) throw e1
  await sbloccaM1AlPagamento(orderId)
}

async function confermaPagamentoCassa(orderId, tipoPagamento = 'contanti') {
  const { error: e1 } = await sb.from('orders').update({
    stato: 'confermato',
    tipo_pagamento: tipoPagamento,
    pagato_at: new Date().toISOString(),
    stornato_at: null,
  }).eq('id', orderId)
  if (e1) throw e1
  await sb.from('order_items').update({ mandata_stato: 'in_attesa' })
    .eq('order_id', orderId).eq('mandata_stato', 'in_pausa')
  await sbloccaM1AlPagamento(orderId)
}

async function sbloccaM1AlPagamento(orderId) {
  const now = new Date().toISOString()
  await sb.from('order_items').update({
    mandata_stato: 'sbloccata',
    sbloccata_at: now,
    mandata_inviata_at: now,
  }).eq('order_id', orderId).eq('mandata', 1)
    .in('categoria', ['bar', 'cucina'])
    .in('mandata_stato', ['in_attesa', 'pre_riscaldo'])
}

async function fetchOrderWithItems(orderId) {
  const { data, error } = await sb.from('orders')
    .select('*, order_items(*)').eq('id', orderId).single()
  if (error) throw error
  return data
}

async function cleanup() {
  for (const id of created) {
    await sb.from('orders').delete().eq('id', id)
  }
}

// ------------------------------------------------------------
// TESTS
// ------------------------------------------------------------

async function testBancomat() {
  console.log('\n== Test 1: BANCOMAT ==')
  const { bar, cucina } = await pickMenuItems()

  const o = await createOrder({
    tavolo: 901,
    pagamento: 'bancomat',
    items: [
      { menuItem: bar,    quantita: 2, mandata: 1 },
      { menuItem: cucina, quantita: 1, mandata: 1 },
      { menuItem: cucina, quantita: 1, mandata: 2 },
    ],
  })

  let snap = await fetchOrderWithItems(o.id)
  snap.stato === 'attesa_bancomat'
    ? pass('createOrder bancomat → stato = attesa_bancomat')
    : fail(`stato post-create = ${snap.stato} (atteso attesa_bancomat)`)
  snap.pagato_at == null
    ? pass('pagato_at = null')
    : fail(`pagato_at = ${snap.pagato_at} (atteso null)`)
  snap.order_items.every(i => i.mandata_stato === 'in_attesa')
    ? pass('tutti gli items partono in_attesa')
    : fail('items in stato inatteso al create')

  await confermaPagamentoBancomat(o.id)
  snap = await fetchOrderWithItems(o.id)

  snap.stato === 'confermato'
    ? pass('confermaPagamentoBancomat → stato = confermato')
    : fail(`stato post-conferma = ${snap.stato}`)
  snap.pagato_at != null
    ? pass('pagato_at valorizzato')
    : fail('pagato_at = null dopo conferma')

  const m1 = snap.order_items.filter(i => i.mandata === 1)
  const m2 = snap.order_items.filter(i => i.mandata === 2)
  m1.every(i => i.mandata_stato === 'sbloccata')
    ? pass(`M1 (bar+cucina, ${m1.length} items) → sbloccata`)
    : fail(`M1 con stati ${m1.map(i => i.mandata_stato).join(',')}`)
  m2.every(i => i.mandata_stato === 'in_attesa')
    ? pass('M2 resta in_attesa (corretto: sblocco solo M1)')
    : fail(`M2 con stati ${m2.map(i => i.mandata_stato).join(',')}`)

  const m1Cats = new Set(m1.map(i => i.categoria))
  m1Cats.has('bar') && m1Cats.has('cucina')
    ? pass('M1 sbloccata su bar E cucina')
    : fail(`M1 categorie sbloccate: ${[...m1Cats].join(',')}`)
}

async function testContanti() {
  console.log('\n== Test 2: CONTANTI (via cassa) ==')
  const { bar, cucina } = await pickMenuItems()

  const o = await createOrder({
    tavolo: 902,
    pagamento: 'contanti',
    items: [
      { menuItem: bar,    quantita: 1, mandata: 1 },
      { menuItem: cucina, quantita: 1, mandata: 1 },
    ],
  })

  let snap = await fetchOrderWithItems(o.id)
  snap.stato === 'attesa_cassa'
    ? pass('createOrder contanti → stato = attesa_cassa')
    : fail(`stato post-create = ${snap.stato}`)

  await confermaPagamentoCassa(o.id, 'contanti')
  snap = await fetchOrderWithItems(o.id)

  snap.stato === 'confermato'
    ? pass('confermaPagamentoCassa → stato = confermato')
    : fail(`stato post-conferma = ${snap.stato}`)

  const m1 = snap.order_items.filter(i => i.mandata === 1)
  m1.every(i => i.mandata_stato === 'sbloccata')
    ? pass(`M1 sbloccata su bar E cucina dopo conferma cassa`)
    : fail(`M1 stati = ${m1.map(i => i.mandata_stato).join(',')}`)
}

async function testConstraint() {
  console.log('\n== Test 3: CHECK constraint DB ==')
  // Crea un ordine valido, poi prova ad aggiornarlo a uno stato fasullo.
  const { bar } = await pickMenuItems()
  const o = await createOrder({
    tavolo: 903,
    pagamento: 'contanti',
    items: [{ menuItem: bar, quantita: 1, mandata: 1 }],
  })
  const { error } = await sb.from('orders').update({ stato: 'foo_bar_baz' }).eq('id', o.id)
  if (error && /violates check constraint/.test(error.message)) {
    pass(`constraint orders_stato_check rifiuta stati ignoti (${error.code})`)
  } else if (error) {
    fail(`errore inatteso: ${error.message}`)
  } else {
    fail('aggiornamento a stato fasullo NON rifiutato — constraint mancante o troppo permissivo')
  }
}

// ------------------------------------------------------------

;(async () => {
  try {
    await testBancomat()
    await testContanti()
    await testConstraint()
  } catch (e) {
    console.error('FATAL:', e?.message || e)
    process.exitCode = 1
  } finally {
    await cleanup()
    console.log(`\nCleanup: rimossi ${created.length} ordini di test`)
    console.log(process.exitCode ? '\n❌ ALCUNI TEST FALLITI' : '\n✅ TUTTI I TEST PASSATI')
  }
})()
