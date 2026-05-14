import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import MenuSelector, { flattenQuantities } from '../components/MenuSelector.jsx'
import TableBadge from '../components/TableBadge.jsx'
import ServizioBadge from '../components/ServizioBadge.jsx'
import { getServizioAttuale } from '../utils/servizio.js'
import {
  groupByMandata,
  getNumeriMandata,
  getStatoMandataDisplay,
} from '../utils/mandateUtils.js'

// -------------------- AUDIO (Web Audio API) --------------------

let audioCtx = null
function getAudioCtx() {
  if (audioCtx === null) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)() }
    catch { audioCtx = false }
  }
  return audioCtx || null
}

function playReadyBeep() {
  const ctx = getAudioCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const beep = (freq, whenSec, durSec) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = freq; osc.type = 'sine'
    const t0 = ctx.currentTime + whenSec
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec)
    osc.start(t0); osc.stop(t0 + durSec + 0.05)
  }
  beep(880,  0,    0.20)
  beep(1318, 0.18, 0.24)
}

// -------------------- HELPER STATI ORDINE --------------------

// Stato "globale" di un ordine per il cameriere, dal punto di vista visivo.
//   'pronto'   -> almeno una mandata ha stato 'pronta' (da portare)
//   'attivo'   -> tutto in preparazione/attesa
//   'consegnato' -> tutte le mandate consegnate
function statoCameriereOrdine(items) {
  if (!items || items.length === 0) return 'attivo'
  const tutti = items
  const tuttiConsegnati = tutti.every(i => i.mandata_stato === 'consegnata')
  if (tuttiConsegnati) return 'consegnato'
  const haPronto = tutti.some(i => i.mandata_stato === 'pronta')
  if (haPronto) return 'pronto'
  return 'attivo'
}

const TICK_MS = 30_000

// -------------------- CAMERIERE PAGE --------------------

export default function CamerierePage({ user, onLogout }) {
  const [view, setView] = useState('list') // 'list' | 'new' | 'detail' | 'payment'
  const [selectedId, setSelectedId] = useState(null)
  const [menu, setMenu] = useState([])
  const [menuLoading, setMenuLoading] = useState(false)

  // Stato bozza per il flusso "nuovo ordine"
  const [draft, setDraft] = useState(null)
  // { tavolo, persone, nomeCliente, note, qty } dove qty = { itemId: { quantita, mandata } }

  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cameriereSound') ?? 'true') }
    catch { return true }
  })
  useEffect(() => {
    localStorage.setItem('cameriereSound', JSON.stringify(soundEnabled))
  }, [soundEnabled])

  const {
    orders, fetchOrdiniAttivi,
    createOrder, addItemsToOrder,
    markMandataConsegnata, inviaM4,
    stornaOrdine, fetchImpostazioni,
  } = useOrders()

  const [impostazioni, setImpostazioni] = useState({})
  useEffect(() => { fetchImpostazioni().then(setImpostazioni).catch(() => {}) }, [fetchImpostazioni])

  const [servizioCorrente, setServizioCorrente] = useState(getServizioAttuale())
  const refetchOrders = useCallback(
    () => fetchOrdiniAttivi(servizioCorrente),
    [fetchOrdiniAttivi, servizioCorrente]
  )
  useEffect(() => { refetchOrders() }, [refetchOrders])

  // Auto-switch pranzo/cena
  useEffect(() => {
    const interval = setInterval(() => {
      const nuovo = getServizioAttuale()
      if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
    }, 60_000)
    return () => clearInterval(interval)
  }, [servizioCorrente])

  const loadMenu = useCallback(async () => {
    setMenuLoading(true)
    const { data } = await supabase
      .from('menu_items').select('*')
      .eq('attivo', true).order('ordine')
    setMenu(data || [])
    setMenuLoading(false)
  }, [])
  useEffect(() => { loadMenu() }, [loadMenu])
  useEffect(() => { if (view === 'new') loadMenu() }, [view, loadMenu])

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('cameriere-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' },
        () => refetchOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },
        () => refetchOrders())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [refetchOrders])

  // Notifica sonora: quando un ordine ha NUOVE mandate 'pronte'
  const lastReadyRef = useRef(null)
  useEffect(() => {
    const readySet = new Set()
    for (const o of orders) {
      const groups = groupByMandata(o.order_items || [])
      for (const m of Object.keys(groups)) {
        if (getStatoMandataDisplay(groups[m]) === 'pronta') {
          readySet.add(`${o.id}::${m}`)
        }
      }
    }
    if (lastReadyRef.current === null) {
      lastReadyRef.current = readySet
      return
    }
    const fresh = [...readySet].filter(k => !lastReadyRef.current.has(k))
    if (fresh.length > 0 && soundEnabled) playReadyBeep()
    lastReadyRef.current = readySet
  }, [orders, soundEnabled])

  // Tick per i minuti
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // Protezioni navigazione
  useEffect(() => {
    if (view !== 'new' && view !== 'payment') return
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = 'Hai un ordine in corso. Sei sicuro di voler uscire?'
      return e.returnValue
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [view])

  useEffect(() => {
    if (view === 'list') {
      window.history.pushState(null, '', window.location.href)
      const onPop = () => {
        const ok = window.confirm("Vuoi uscire dall'app?")
        if (ok) window.history.back()
        else window.history.pushState(null, '', window.location.href)
      }
      window.addEventListener('popstate', onPop)
      return () => window.removeEventListener('popstate', onPop)
    }
    if (view === 'new' || view === 'payment') {
      window.history.pushState(null, '', window.location.href)
      const onPop = () => {
        const ok = window.confirm('Hai un ordine in corso. Vuoi annullare e tornare indietro?')
        if (ok) { setDraft(null); setView('list') }
        else window.history.pushState(null, '', window.location.href)
      }
      window.addEventListener('popstate', onPop)
      return () => window.removeEventListener('popstate', onPop)
    }
    if (view === 'detail') {
      window.history.pushState(null, '', window.location.href)
      const onPop = () => { setView('list'); setSelectedId(null) }
      window.addEventListener('popstate', onPop)
      return () => window.removeEventListener('popstate', onPop)
    }
  }, [view])

  const onLeftAction = view !== 'list' && (
    <button
      onClick={() => {
        if (view === 'payment') { setView('new'); return }
        setView('list'); setSelectedId(null); setDraft(null)
      }}
      className="px-3 py-1 rounded-lg bg-white/20 text-sm font-semibold"
    >
      ← Indietro
    </button>
  )

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        color="bg-cameriere"
        nome={user.nome}
        ruolo="Cameriere"
        onLogout={onLogout}
        impostazioni={impostazioni}
        soundEnabled={soundEnabled}
        onToggleSound={() => {
          if (!soundEnabled) {
            const ctx = getAudioCtx()
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
          }
          setSoundEnabled(s => !s)
        }}
        leftAction={onLeftAction}
      />

      <main className="flex-1 p-4">
        {view === 'list' && (
          <ListaTavoli
            orders={orders}
            onNew={() => setView('new')}
            onSelect={(id) => { setSelectedId(id); setView('detail') }}
          />
        )}
        {view === 'new' && (
          <NuovoOrdine
            menu={menu}
            initialDraft={draft}
            onRefresh={loadMenu}
            refreshing={menuLoading}
            onProceedToPayment={(d) => {
              setDraft(d)
              setView('payment')
            }}
          />
        )}
        {view === 'payment' && draft && (
          <ScegliPagamento
            draft={draft}
            menu={menu}
            onBack={() => setView('new')}
            onConfirm={async (pagamento) => {
              const servizio = getServizioAttuale()
              const itemsArr = flattenQuantities(draft.qty).map(r => {
                const menuItem = menu.find(m => m.id === r.itemId)
                return menuItem ? {
                  menuItem,
                  quantita: r.quantita,
                  mandata: r.mandata,
                } : null
              }).filter(Boolean)

              try {
                await createOrder({
                  tavolo: parseInt(draft.tavolo, 10),
                  persone: Math.max(1, parseInt(draft.persone, 10) || 1),
                  nomeCliente: draft.nomeCliente.trim(),
                  items: itemsArr,
                  pagamento,
                  note: draft.note || null,
                  servizio,
                  cameriereNome: user.nome,
                  cameriereId: user.id,
                })
                await refetchOrders()
                setDraft(null)
                setView('list')
                if (pagamento === 'contanti') {
                  alert(`Invia il cliente in cassa con:\nTav. ${draft.tavolo} · ${draft.nomeCliente}`)
                }
              } catch (e) {
                alert('Errore creazione ordine: ' + (e.message || e))
              }
            }}
          />
        )}
        {view === 'detail' && selectedId && (
          <DettaglioOrdine
            orderId={selectedId}
            menu={menu}
            onAddItems={async (items, opts) => {
              await addItemsToOrder(selectedId, items, opts)
              await refetchOrders()
            }}
            onMandataConsegnata={async (mandataNum, categoria) => {
              await markMandataConsegnata(selectedId, mandataNum, categoria)
              await refetchOrders()
            }}
            onInviaM4={async () => {
              await inviaM4(selectedId)
              await refetchOrders()
            }}
            onStorna={async (note, tipoPagamentoOverride) => {
              await stornaOrdine(selectedId, note, tipoPagamentoOverride)
              await refetchOrders()
              setView('list')
              setSelectedId(null)
            }}
          />
        )}
      </main>
    </div>
  )
}

// -------------------- Header --------------------

function Header({ color, nome, ruolo, onLogout, leftAction, soundEnabled, onToggleSound, impostazioni }) {
  return (
    <header className={`${color} px-4 py-3 flex items-center justify-between gap-2
                        sticky top-0 z-30 mobile-landscape:py-2`}>
      <div className="flex items-center gap-2 min-w-0">
        {leftAction}
        <div className="min-w-0">
          <p className="font-bold truncate">{nome}</p>
          <p className="text-xs opacity-90 mobile-landscape:hidden">{ruolo}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ServizioBadge impostazioni={impostazioni} />
        {onToggleSound && (
          <button
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'Disattiva suono' : 'Attiva suono'}
            title={soundEnabled ? 'Disattiva suono' : 'Attiva suono'}
            className="px-3 py-2 rounded-lg bg-white/20 text-base"
          >
            {soundEnabled ? '🔔' : '🔕'}
          </button>
        )}
        <button
          onClick={onLogout}
          className="px-3 py-2 rounded-lg bg-white/20 text-sm font-semibold"
        >
          Esci
        </button>
      </div>
    </header>
  )
}

// -------------------- LISTA TAVOLI --------------------

function ListaTavoli({ orders, onNew, onSelect }) {
  const pronti  = []
  const attivi  = []
  const inCassa = []
  const stornati = []

  for (const o of orders) {
    if (o.stato === 'attesa_cassa') { inCassa.push(o); continue }
    if (o.stato === 'stornato')     { stornati.push(o); continue }
    const stato = statoCameriereOrdine(o.order_items || [])
    if (stato === 'pronto') pronti.push(o)
    else attivi.push(o)
  }

  return (
    <div className="space-y-4">
      <button onClick={onNew} className="btn-primary w-full text-lg">
        + Nuovo Tavolo
      </button>

      {pronti.length > 0 && (
        <div className="bg-green-700 text-white px-4 py-3 rounded-xl font-bold
                        text-center shadow-lg animate-pulse">
          🟢 {pronti.length} mandat{pronti.length === 1 ? 'a pronta' : 'e pronte'} da portare!
        </div>
      )}

      {orders.length === 0 && (
        <p className="text-center opacity-60 py-8">Nessun ordine</p>
      )}

      <SezioneCards titolo="🟢 Pronti da portare"  orders={pronti}   onSelect={onSelect} />
      <SezioneCards titolo="🟡 In preparazione"    orders={attivi}   onSelect={onSelect} />
      <SezioneCards titolo="💵 In attesa cassa"    orders={inCassa}  onSelect={onSelect} variant="warning" />
      <SezioneCards titolo="⚠️ Stornati"           orders={stornati} onSelect={onSelect} variant="danger" />
    </div>
  )
}

function SezioneCards({ titolo, orders, onSelect, variant }) {
  if (orders.length === 0) return null
  return (
    <div>
      <h3 className="font-bold mb-2 text-base">
        {titolo} <span className="text-sm font-normal opacity-60">({orders.length})</span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                      mobile-landscape:grid-cols-2 gap-3">
        {orders.map(o => (
          <CompactOrderCard key={o.id} order={o} onSelect={onSelect} variant={variant} />
        ))}
      </div>
    </div>
  )
}

// -------------------- COMPACT ORDER CARD --------------------

function CompactOrderCard({ order, onSelect, variant }) {
  const items = order.order_items || []
  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')
  const cucinaGroups = groupByMandata(cucinaItems)
  const barGroups    = groupByMandata(barItems)
  const cucinaNumeri = getNumeriMandata(cucinaItems)
  const barNumeri    = getNumeriMandata(barItems)

  const minuti = Math.max(0, Math.floor((Date.now() - new Date(order.created_at)) / 60000))
  const ora = new Date(order.created_at)
    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

  // Bar M2 bloccata visibile?
  const barM2Bloccata = barGroups[2] && barGroups[2].every(i => i.mandata_stato === 'in_attesa')

  let bordo = 'border-l-yellow-500 bg-yellow-900/15'
  let pulse = ''
  if (variant === 'warning') bordo = 'border-l-amber-500 bg-amber-900/15'
  else if (variant === 'danger') bordo = 'border-l-red-500 bg-red-900/15'
  else {
    const stato = statoCameriereOrdine(items)
    if (stato === 'pronto') { bordo = 'border-l-green-500 bg-green-900/20'; pulse = 'animate-pulse' }
    else if (stato === 'consegnato') { bordo = 'border-l-blue-500 bg-blue-900/15' }
  }

  const renderRiepilogoMandate = (numeri, groups) => {
    if (numeri.length === 0) return null
    return (
      <span className="text-xs">
        {numeri.map(n => {
          const s = getStatoMandataDisplay(groups[n])
          let icon = '⏳'
          if (s === 'in_pausa')      icon = '⏸️'
          else if (s === 'consegnata') icon = '✅'
          else if (s === 'pronta')     icon = '🟢'
          else if (s === 'in_preparazione') icon = '🔥'
          else if (groups[n].every(i => i.mandata_stato === 'in_attesa') && groups[n].some(i => i.categoria === 'bar' && i.mandata === 2)) icon = '🔒'
          return <span key={n} className="ml-1">M{n}{icon}</span>
        })}
      </span>
    )
  }

  return (
    <div
      onClick={() => onSelect && onSelect(order.id)}
      className={`relative card border-l-4 ${bordo} ${pulse}
                  cursor-pointer active:scale-[0.98] transition-transform`}
    >
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="md" />
        {order.nome_cliente && (
          <span className="text-sm font-bold">· {order.nome_cliente}</span>
        )}
        {order.tipo_pagamento === 'bancomat' && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/50 border border-blue-700">
            💳
          </span>
        )}
        {order.tipo_pagamento === 'contanti' && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/50 border border-emerald-700">
            💵
          </span>
        )}
        {order.stato === 'attesa_cassa' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-700 text-white uppercase tracking-wide">
            in cassa
          </span>
        )}
        {order.stato === 'stornato' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-700 text-white uppercase tracking-wide">
            stornato
          </span>
        )}
        <span className="ml-auto font-bold text-base text-green-400">
          € {Number(order.totale).toFixed(2)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>🍳 {renderRiepilogoMandate(cucinaNumeri, cucinaGroups) || '—'}</span>
        <span>🍺 {renderRiepilogoMandate(barNumeri, barGroups) || '—'}</span>
      </div>

      <div className="mt-1 flex items-center justify-between text-xs opacity-70">
        <span>{ora} · ⏱ {minuti} min</span>
        {barM2Bloccata && (
          <span className="text-yellow-400 font-semibold">🔒 Caffè/amari in attesa</span>
        )}
      </div>
    </div>
  )
}

// -------------------- VISTA NUOVO ORDINE --------------------

function NuovoOrdine({ menu, initialDraft, onProceedToPayment, onRefresh, refreshing }) {
  const [tavolo, setTavolo] = useState(initialDraft?.tavolo ?? '')
  const [persone, setPersone] = useState(initialDraft?.persone ?? '1')
  const [nomeCliente, setNomeCliente] = useState(initialDraft?.nomeCliente ?? '')
  const [note, setNote] = useState(initialDraft?.note ?? '')
  const [qty, setQty] = useState(initialDraft?.qty ?? {})
  const tavoloRef = useRef(null)

  const itemsArr = useMemo(() => {
    return flattenQuantities(qty).map(r => {
      const menuItem = menu.find(m => m.id === r.itemId)
      return menuItem ? { menuItem, quantita: r.quantita, mandata: r.mandata } : null
    }).filter(Boolean)
  }, [qty, menu])

  const totale = itemsArr.reduce(
    (s, it) => s + Number(it.menuItem.prezzo) * it.quantita, 0
  )

  const totPezzi = itemsArr.reduce((s, it) => s + it.quantita, 0)

  const canSubmit =
    tavolo && Number(tavolo) > 0
    && nomeCliente.trim().length > 0
    && itemsArr.length > 0

  const submit = () => {
    if (!canSubmit) return
    onProceedToPayment({ tavolo, persone, nomeCliente, note, qty })
  }

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm opacity-70">Nuovo ordine</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Ricarica menu"
          title="Ricarica menu"
          className={`w-9 h-9 rounded-lg bg-pannello border border-bordo text-base
                      flex items-center justify-center
                      active:scale-95 transition-transform
                      disabled:opacity-50 ${refreshing ? 'animate-spin' : ''}`}
        >
          🔄
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="text-sm opacity-80">N. Tavolo</span>
          <input
            ref={tavoloRef}
            type="number" inputMode="numeric" min="1"
            value={tavolo} onChange={e => setTavolo(e.target.value)}
            className="input-base mt-1" placeholder="es. 12"
          />
        </label>
        <label className="block">
          <span className="text-sm opacity-80">N. Persone</span>
          <input
            type="number" inputMode="numeric" min="1"
            value={persone} onChange={e => setPersone(e.target.value)}
            className="input-base mt-1"
          />
        </label>
      </div>

      <label className="block mb-3">
        <span className="text-sm opacity-80">Nome cliente *</span>
        <input
          type="text"
          value={nomeCliente}
          onChange={e => setNomeCliente(e.target.value)}
          className="input-base mt-1"
          placeholder="Nome del capotavola (es. Mattia)"
          required
        />
      </label>

      <label className="block mb-3">
        <span className="text-sm opacity-80">Note (opzionali)</span>
        <input
          type="text" value={note} onChange={e => setNote(e.target.value)}
          className="input-base mt-1" placeholder="Allergie, richieste..."
        />
      </label>

      <MenuSelector
        items={menu}
        quantities={qty}
        onChange={setQty}
        footer={
          <div className="rounded-xl border border-bordo bg-pannello p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm opacity-80">{totPezzi} pezzi</span>
              <span className="text-xl font-bold">€ {totale.toFixed(2)}</span>
            </div>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="btn-success w-full text-lg"
            >
              Avanti → Pagamento
            </button>
            {!canSubmit && (
              <p className="text-xs opacity-70 mt-2 text-center">
                Compila tavolo, nome cliente e almeno una voce
              </p>
            )}
          </div>
        }
      />
    </div>
  )
}

// -------------------- SCELTA PAGAMENTO --------------------

function ScegliPagamento({ draft, menu, onBack, onConfirm }) {
  const [busy, setBusy] = useState(false)

  const itemsArr = useMemo(() => {
    return flattenQuantities(draft.qty).map(r => {
      const menuItem = menu.find(m => m.id === r.itemId)
      return menuItem ? { menuItem, quantita: r.quantita, mandata: r.mandata } : null
    }).filter(Boolean)
  }, [draft, menu])

  const totale = itemsArr.reduce(
    (s, it) => s + Number(it.menuItem.prezzo) * it.quantita, 0
  )

  const handleBancomat = async () => {
    const ok = window.confirm(`Pagamento di € ${totale.toFixed(2)} ricevuto con bancomat?`)
    if (!ok) return
    setBusy(true)
    try { await onConfirm('bancomat') } finally { setBusy(false) }
  }

  const handleContanti = async () => {
    setBusy(true)
    try { await onConfirm('contanti') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4 pb-6">
      <h2 className="text-xl font-bold">Riepilogo ordine</h2>

      <div className="card space-y-1">
        <p className="text-sm opacity-80">
          Tav. <strong>{draft.tavolo}</strong> · {draft.persone} pers. · <strong>{draft.nomeCliente}</strong>
        </p>
        {draft.note && (
          <p className="text-sm bg-yellow-900/30 border border-yellow-700 rounded-lg p-2">
            Note: {draft.note}
          </p>
        )}
        <ul className="text-sm divide-y divide-bordo">
          {itemsArr.map((it, idx) => (
            <li key={`${it.menuItem.id}-${it.mandata}-${idx}`} className="py-1 flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cameriere/40 border border-cameriere">
                M{it.mandata}
              </span>
              <span className="flex-1">{it.menuItem.nome}</span>
              <span className="opacity-80">× {it.quantita}</span>
              <span className="font-semibold">
                € {(Number(it.menuItem.prezzo) * it.quantita).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        <div className="pt-2 border-t border-bordo flex items-center justify-between">
          <span className="text-sm opacity-80">Totale</span>
          <span className="text-2xl font-bold text-green-400">
            € {totale.toFixed(2)}
          </span>
        </div>
      </div>

      <h3 className="font-bold text-lg mt-2">Metodo di pagamento</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          disabled={busy}
          onClick={handleBancomat}
          className="card bg-blue-900/30 border-2 border-blue-700 hover:bg-blue-900/50
                     min-h-[6rem] flex flex-col items-center justify-center text-xl font-bold"
        >
          💳 BANCOMAT
          <span className="text-xs font-normal opacity-80 mt-1">
            Incasso immediato, parte a cucina/bar
          </span>
        </button>
        <button
          disabled={busy}
          onClick={handleContanti}
          className="card bg-emerald-900/30 border-2 border-emerald-700 hover:bg-emerald-900/50
                     min-h-[6rem] flex flex-col items-center justify-center text-xl font-bold"
        >
          💵 CONTANTI
          <span className="text-xs font-normal opacity-80 mt-1">
            Cliente in cassa, attende incasso
          </span>
        </button>
      </div>

      <button onClick={onBack} disabled={busy} className="btn-neutral w-full">
        ← Cambia ordine
      </button>
    </div>
  )
}

// -------------------- DETTAGLIO ORDINE --------------------

function DettaglioOrdine({ orderId, menu, onAddItems, onMandataConsegnata, onInviaM4, onStorna }) {
  const [order, setOrder] = useState(null)
  // adding: null | true (M4 e' libera dalla creazione, non serve modalita' separata)
  const [adding, setAdding] = useState(false)
  const [qty, setQty] = useState({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('orders').select('*, order_items(*)').eq('id', orderId).single()
    setOrder(data)
  }, [orderId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel(`dettaglio-${orderId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${orderId}` },
        () => load())
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [orderId, load])

  if (!order) return <p className="text-center opacity-60 py-10">Caricamento…</p>

  const items = order.order_items || []

  // VISTA "AGGIUNGI ITEMS"
  if (adding) {
    const itemsArr = flattenQuantities(qty).map(r => {
      const m = menu.find(mm => mm.id === r.itemId)
      return m ? { menuItem: m, quantita: r.quantita, mandata: r.mandata } : null
    }).filter(Boolean)
    const totaleAgg = itemsArr.reduce(
      (s, it) => s + Number(it.menuItem.prezzo) * it.quantita, 0
    )
    const totPezziAgg = itemsArr.reduce((s, it) => s + it.quantita, 0)

    return (
      <div className="pb-6">
        <p className="mb-3 font-semibold">
          Aggiungi al tavolo {order.numero_tavolo}{order.nome_cliente ? ' · ' + order.nome_cliente : ''}
        </p>
        <MenuSelector
          items={menu}
          quantities={qty}
          onChange={setQty}
          footer={
            <div className="rounded-xl border border-bordo bg-pannello p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm opacity-80">{totPezziAgg} pezzi</span>
                <span className="text-xl font-bold">+ € {totaleAgg.toFixed(2)}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setAdding(false); setQty({}) }}
                  className="btn-neutral flex-1"
                >
                  Annulla
                </button>
                <button
                  disabled={itemsArr.length === 0 || busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await onAddItems(itemsArr)
                      setQty({})
                      setAdding(false)
                      await load()
                    } catch (e) {
                      alert('Errore: ' + (e.message || e))
                    } finally {
                      setBusy(false)
                    }
                  }}
                  className="btn-success flex-1"
                >
                  Aggiungi
                </button>
              </div>
            </div>
          }
        />
      </div>
    )
  }

  const stornato = order.stato === 'stornato'
  const inCassa  = order.stato === 'attesa_cassa'
  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')
  const cucinaGroups = groupByMandata(cucinaItems)
  const barGroups    = groupByMandata(barItems)
  const cucinaNumeri = getNumeriMandata(cucinaItems)
  const barNumeri    = getNumeriMandata(barItems)

  // "Invia M4" disponibile se l'ordine ha items M4 ancora in_attesa
  // (non ancora rilasciati al bar) e non e' stornato/in cassa.
  const m4Items = items.filter(i => i.mandata === 4)
  const m4DaInviare = m4Items.length > 0 && m4Items.some(i => i.mandata_stato === 'in_attesa')
  const puoInviareM4 = !stornato && !inCassa && m4DaInviare

  const azioneStorna = async () => {
    const note = window.prompt('Motivo dello storno (opzionale):')
    if (note === null) return // cancel
    if (!window.confirm('Confermi lo storno? L\'ordine viene messo in pausa.')) return
    try {
      setBusy(true)
      await onStorna(note || null, null)
    } catch (e) {
      alert('Errore: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const azionePassaAContanti = async () => {
    if (!window.confirm('Passare da bancomat a contanti?\nL\'ordine viene stornato e finisce in cassa.')) return
    try {
      setBusy(true)
      await onStorna('Cambio metodo a contanti', 'contanti')
    } catch (e) {
      alert('Errore: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg" />
          {order.nome_cliente && (
            <span className="text-xl font-bold">· {order.nome_cliente}</span>
          )}
        </div>
        <span className="text-2xl font-bold text-green-400">
          € {Number(order.totale).toFixed(2)}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {order.tipo_pagamento === 'bancomat' && (
          <span className="badge bg-blue-700 text-white">💳 Bancomat</span>
        )}
        {order.tipo_pagamento === 'contanti' && (
          <span className="badge bg-emerald-700 text-white">💵 Contanti</span>
        )}
        {inCassa && (
          <span className="badge bg-amber-700 text-white">⏳ In attesa cassa</span>
        )}
        {stornato && (
          <span className="badge bg-red-700 text-white animate-pulse">⚠️ Stornato</span>
        )}
      </div>

      {stornato && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl p-3">
          <p className="font-bold text-red-300 mb-1">ORDINE IN PAUSA</p>
          {order.storno_note && (
            <p className="text-sm break-words">Motivo: {order.storno_note}</p>
          )}
          <p className="text-xs opacity-80 mt-1">
            La cassa lo ri-confermerà dopo l'incasso.
          </p>
        </div>
      )}

      {order.note && (
        <p className="text-sm bg-yellow-900/40 border border-yellow-700 rounded-xl p-2">
          Note: {order.note}
        </p>
      )}

      {/* Cucina */}
      <SezioneMandate
        titolo="🍳 Cucina"
        colore="text-cucina"
        numeri={cucinaNumeri}
        groups={cucinaGroups}
        categoria="cucina"
        disabled={stornato || inCassa}
        onConsegnata={(n) => onMandataConsegnata(n, 'cucina')}
      />

      {/* Bar */}
      <SezioneMandate
        titolo="🍺 Bar"
        colore="text-bar"
        numeri={barNumeri}
        groups={barGroups}
        categoria="bar"
        disabled={stornato || inCassa}
        onConsegnata={(n) => onMandataConsegnata(n, 'bar')}
      />

      {puoInviareM4 && (
        <button
          disabled={busy}
          onClick={async () => {
            if (!window.confirm('Inviare M4 al bar adesso?\nDolci, caffe\' e amari verranno preparati.')) return
            try {
              setBusy(true)
              await onInviaM4()
            } catch (e) {
              alert('Errore: ' + (e.message || e))
            } finally {
              setBusy(false)
            }
          }}
          className="w-full rounded-xl bg-amber-600 text-white font-bold py-3 active:scale-95 animate-pulse"
        >
          ☕ Invia M4 — Dolci, Caffè e Amari ({m4Items.reduce((s, i) => s + i.quantita, 0)} pezzi)
        </button>
      )}

      {!stornato && !inCassa && (
        <button onClick={() => setAdding(true)} className="btn-neutral w-full" disabled={busy}>
          + Aggiungi item
        </button>
      )}

      {!stornato && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            disabled={busy}
            onClick={azioneStorna}
            className="px-3 py-3 rounded-xl font-semibold bg-red-700 text-white active:scale-95"
          >
            ⚠️ Storna ordine
          </button>
          {order.tipo_pagamento === 'bancomat' && (
            <button
              disabled={busy}
              onClick={azionePassaAContanti}
              className="px-3 py-3 rounded-xl font-semibold bg-amber-700 text-white active:scale-95"
            >
              💵 Passa a contanti
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function SezioneMandate({ titolo, colore, numeri, groups, categoria, disabled, onConsegnata }) {
  if (numeri.length === 0) return null
  return (
    <div>
      <h3 className={`font-bold mb-2 ${colore}`}>{titolo}</h3>
      <ul className="space-y-3">
        {numeri.map(n => (
          <MandataRow
            key={n}
            numero={n}
            items={groups[n]}
            categoria={categoria}
            disabled={disabled}
            onConsegnata={() => onConsegnata(n)}
          />
        ))}
      </ul>
    </div>
  )
}

function MandataRow({ numero, items, categoria, disabled, onConsegnata }) {
  const stato = getStatoMandataDisplay(items)
  const [busy, setBusy] = useState(false)

  const barM2Bloccata = categoria === 'bar' && numero === 2
    && items.every(i => i.mandata_stato === 'in_attesa')

  let bordo = 'border-l-yellow-500 bg-yellow-900/15'
  if (stato === 'consegnata') bordo = 'border-l-blue-500 bg-blue-900/15 opacity-70'
  else if (stato === 'pronta') bordo = 'border-l-green-500 bg-green-900/20'
  else if (stato === 'in_pausa') bordo = 'border-l-red-500 bg-red-900/20'
  else if (barM2Bloccata) bordo = 'border-l-yellow-500 bg-yellow-900/10 opacity-70'

  const headerLabel = (() => {
    if (stato === 'consegnata') return `M${numero} · ✅ consegnata`
    if (stato === 'pronta')     return `M${numero} · 🟢 pronta`
    if (stato === 'in_pausa')   return `M${numero} · ⏸️ in pausa`
    if (stato === 'in_preparazione') return `M${numero} · 🔥 in preparazione`
    if (barM2Bloccata)          return `M${numero} · 🔒 in attesa`
    return `M${numero} · ⏳ in attesa`
  })()

  return (
    <li className={`border-l-4 ${bordo} rounded-r-lg p-2`}>
      <div className="text-xs font-bold uppercase tracking-widest mb-2 opacity-90">
        {headerLabel}
      </div>
      <ul className="text-sm space-y-1">
        {items.map(it => (
          <li key={it.id} className="flex items-center justify-between gap-2">
            <span className="break-words whitespace-normal">{it.nome_item}</span>
            <span className="opacity-80 shrink-0">× {it.quantita}</span>
          </li>
        ))}
      </ul>
      {stato === 'pronta' && !disabled && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try { await onConsegnata() } finally { setBusy(false) }
          }}
          className="btn-success w-full mt-2 text-sm py-1"
        >
          ✓ Consegnata al tavolo
        </button>
      )}
    </li>
  )
}
