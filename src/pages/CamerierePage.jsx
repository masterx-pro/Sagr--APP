import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import MenuSelector from '../components/MenuSelector.jsx'
import TableBadge from '../components/TableBadge.jsx'
import ServizioBadge from '../components/ServizioBadge.jsx'
import { getServizioAttuale, getDataServizio, dataLocaleToUtcRange } from '../utils/servizio.js'

// -------------------- AUDIO (Web Audio API, niente file esterni) --------------------

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
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    osc.type = 'sine'
    const t0 = ctx.currentTime + whenSec
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec)
    osc.start(t0)
    osc.stop(t0 + durSec + 0.05)
  }
  beep(880,  0,    0.20)  // A5
  beep(1318, 0.18, 0.24)  // E6
}

// -------------------- HELPER STATO TAVOLO --------------------

function statoTavolo(items) {
  if (!items || items.length === 0) return 'rosso'
  const cuc = items.filter(i => i.categoria === 'cucina')
  const bar = items.filter(i => i.categoria === 'bar')
  const cucOk = cuc.length === 0 || cuc.every(i => i.pronto)
  const barOk = bar.length === 0 || bar.every(i => i.pronto)
  if (cucOk && barOk) return 'verde'
  if (cucOk || barOk) return 'giallo'
  return 'rosso'
}

const STATO_BORDO = {
  verde:  'border-l-green-500  bg-green-900/20',
  giallo: 'border-l-yellow-500 bg-yellow-900/15',
  rosso:  'border-l-red-500    bg-red-900/15',
}

const TICK_MS = 30_000

// -------------------- CAMERIERE PAGE --------------------

export default function CamerierePage({ user, onLogout }) {
  const [view, setView] = useState('list') // list | new | detail
  const [selectedId, setSelectedId] = useState(null)
  const [addingForId, setAddingForId] = useState(null)
  const [menu, setMenu] = useState([])
  const [menuLoading, setMenuLoading] = useState(false)

  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cameriereSound') ?? 'true') }
    catch { return true }
  })
  useEffect(() => {
    localStorage.setItem('cameriereSound', JSON.stringify(soundEnabled))
  }, [soundEnabled])

  // Tracking "consegnati" lato device
  const [consegnatiIds, setConsegnatiIdsRaw] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('cameriereConsegnati') ?? '[]')) }
    catch { return new Set() }
  })
  const persistConsegnati = (s) => {
    localStorage.setItem('cameriereConsegnati', JSON.stringify([...s]))
  }
  const segnaConsegnato = (id) => {
    const s = new Set(consegnatiIds); s.add(id); setConsegnatiIdsRaw(s); persistConsegnati(s)
  }
  const annullaConsegnato = (id) => {
    const s = new Set(consegnatiIds); s.delete(id); setConsegnatiIdsRaw(s); persistConsegnati(s)
  }

  const {
    orders, fetchPaidOrders,
    createOrder, addItemsToOrder
  } = useOrders()

  const [servizioCorrente, setServizioCorrente] = useState(getServizioAttuale())
  const refetchOrders = useCallback(
    () => fetchPaidOrders(servizioCorrente),
    [fetchPaidOrders, servizioCorrente]
  )
  useEffect(() => { refetchOrders() }, [refetchOrders])

  // Auto-switch pranzo/cena a 16:00: poll ogni 60s, se cambia → refetch automatico
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

  // Notifica sonora quando un ordine diventa verde (transizione)
  const lastReadyRef = useRef(null) // Set<id>
  useEffect(() => {
    const ready = new Set(
      orders
        .filter(o => statoTavolo(o.order_items || []) === 'verde')
        .map(o => o.id)
    )
    if (lastReadyRef.current === null) {
      // primo render: solo registro lo stato, niente suono
      lastReadyRef.current = ready
      return
    }
    const newReady = [...ready].filter(id => !lastReadyRef.current.has(id))
    if (newReady.length > 0 && soundEnabled) playReadyBeep()
    lastReadyRef.current = ready
  }, [orders, soundEnabled])

  // Tick per aggiornare i timer ogni 30s
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // -------------------- Protezioni navigazione (invariate) --------------------

  useEffect(() => {
    if (view !== 'new') return
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = 'Hai un ordine in corso. Sei sicuro di voler uscire?'
      return 'Hai un ordine in corso. Sei sicuro di voler uscire?'
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [view])

  useEffect(() => {
    if (view !== 'new') return
    window.history.pushState(null, '', window.location.href)
    const onPop = () => {
      const ok = window.confirm('Hai un ordine in corso. Vuoi annullare e tornare indietro?')
      if (ok) setView('list')
      else window.history.pushState(null, '', window.location.href)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [view])

  useEffect(() => {
    if (view !== 'list') return
    window.history.pushState(null, '', window.location.href)
    const onPop = () => {
      const ok = window.confirm("Vuoi uscire dall'app?")
      if (ok) window.history.back()
      else window.history.pushState(null, '', window.location.href)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [view])

  // -------------------- Render --------------------

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        color="bg-cameriere"
        nome={user.nome}
        ruolo="Cameriere"
        onLogout={onLogout}
        soundEnabled={soundEnabled}
        onToggleSound={() => {
          // Tap utente: opportunità per inizializzare AudioContext
          if (!soundEnabled) {
            const ctx = getAudioCtx()
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
          }
          setSoundEnabled(s => !s)
        }}
        leftAction={view !== 'list' && (
          <button
            onClick={() => { setView('list'); setSelectedId(null); setAddingForId(null) }}
            className="px-3 py-1 rounded-lg bg-white/20 text-sm font-semibold"
          >
            ← Indietro
          </button>
        )}
      />

      <main className="flex-1 p-4">
        {view === 'list' && (
          <ListaTavoli
            orders={orders}
            consegnatiIds={consegnatiIds}
            onNew={() => setView('new')}
            onSelect={(id) => { setSelectedId(id); setAddingForId(null); setView('detail') }}
            onQuickAdd={(id) => { setSelectedId(id); setAddingForId(id); setView('detail') }}
            onConsegnato={segnaConsegnato}
            onAnnullaConsegna={annullaConsegnato}
          />
        )}
        {view === 'new' && (
          <NuovoOrdine
            menu={menu}
            onRefresh={loadMenu}
            refreshing={menuLoading}
            onCreate={async (tavolo, persone, items, note, extra) => {
              await createOrder(tavolo, persone, items, note, extra)
              await refetchOrders()
              setView('list')
            }}
          />
        )}
        {view === 'detail' && selectedId && (
          <DettaglioOrdine
            orderId={selectedId}
            menu={menu}
            initialAdding={addingForId === selectedId}
            onAddItems={async (items) => {
              await addItemsToOrder(selectedId, items)
              await refetchOrders()
            }}
          />
        )}
      </main>
    </div>
  )
}

// -------------------- Header --------------------

function Header({ color, nome, ruolo, onLogout, leftAction, soundEnabled, onToggleSound }) {
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
        <ServizioBadge />
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

function ListaTavoli({ orders, consegnatiIds, onNew, onSelect, onQuickAdd,
                      onConsegnato, onAnnullaConsegna }) {
  const verdi   = []
  const gialli  = []
  const rossi   = []
  const consegnati = []

  for (const o of orders) {
    const items = o.order_items || []
    const stato = statoTavolo(items)
    if (stato === 'verde') {
      if (consegnatiIds.has(o.id)) consegnati.push(o)
      else verdi.push(o)
    } else if (stato === 'giallo') gialli.push(o)
    else rossi.push(o)
  }

  const [storicoAperto, setStoricoAperto] = useState(false)

  return (
    <div className="space-y-4">
      <button onClick={onNew} className="btn-primary w-full text-lg">
        + Nuovo Tavolo
      </button>

      {verdi.length > 0 && (
        <div className="bg-green-700 text-white px-4 py-3 rounded-xl font-bold
                        text-center shadow-lg animate-pulse">
          🟢 {verdi.length} tavol{verdi.length === 1 ? 'o' : 'i'} pront{verdi.length === 1 ? 'o' : 'i'} da portare!
        </div>
      )}

      {orders.length === 0 && (
        <p className="text-center opacity-60 py-8">Nessun ordine</p>
      )}

      <SezioneCards
        titolo="🟢 Pronti da portare"
        orders={verdi}
        emptyHidden
        onSelect={onSelect}
        onQuickAdd={onQuickAdd}
        onConsegnato={onConsegnato}
      />
      <SezioneCards
        titolo="🟡 Parzialmente pronti"
        orders={gialli}
        emptyHidden
        onSelect={onSelect}
        onQuickAdd={onQuickAdd}
      />
      <SezioneCards
        titolo="🔴 In preparazione"
        orders={rossi}
        emptyHidden
        onSelect={onSelect}
        onQuickAdd={onQuickAdd}
      />

      {consegnati.length > 0 && (
        <div>
          <button
            onClick={() => setStoricoAperto(s => !s)}
            className="w-full flex items-center justify-between bg-pannello border
                       border-bordo rounded-xl px-4 py-3 font-bold"
          >
            <span>✅ Consegnati ({consegnati.length})</span>
            <span className="opacity-70">{storicoAperto ? '▲' : '▼'}</span>
          </button>
          {storicoAperto && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                            mobile-landscape:grid-cols-2 gap-3">
              {consegnati.map(o => (
                <CompactOrderCard
                  key={o.id}
                  order={o}
                  consegnato
                  onSelect={onSelect}
                  onAnnullaConsegna={onAnnullaConsegna}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SezioneCards({ titolo, orders, emptyHidden, ...handlers }) {
  if (emptyHidden && orders.length === 0) return null
  return (
    <div>
      <h3 className="font-bold mb-2 text-base">
        {titolo}{' '}
        <span className="text-sm font-normal opacity-60">({orders.length})</span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
                      mobile-landscape:grid-cols-2 gap-3">
        {orders.map(o => (
          <CompactOrderCard key={o.id} order={o} {...handlers} />
        ))}
      </div>
    </div>
  )
}

// -------------------- COMPACT ORDER CARD --------------------

function CompactOrderCard({ order, consegnato = false,
                            onSelect, onQuickAdd, onConsegnato, onAnnullaConsegna }) {
  const items = order.order_items || []
  const stato = statoTavolo(items)
  const cuc = items.filter(i => i.categoria === 'cucina')
  const bar = items.filter(i => i.categoria === 'bar')
  const cucOk = cuc.length === 0 || cuc.every(i => i.pronto)
  const barOk = bar.length === 0 || bar.every(i => i.pronto)

  const minuti = Math.max(0, Math.floor((Date.now() - new Date(order.created_at)) / 60000))
  const ora = new Date(order.created_at)
    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

  const bordoCls = consegnato
    ? 'border-l-blue-500 bg-blue-900/15'
    : STATO_BORDO[stato]
  const pulseCls = !consegnato && stato === 'verde' ? 'animate-pulse' : ''

  return (
    <div
      onClick={() => onSelect && onSelect(order.id)}
      className={`relative card border-l-4 ${bordoCls} ${pulseCls}
                  cursor-pointer active:scale-[0.98] transition-transform`}
    >
      {/* Top-right action button */}
      {!consegnato && onQuickAdd && (
        <button
          onClick={(e) => { e.stopPropagation(); onQuickAdd(order.id) }}
          aria-label="Aggiungi item al tavolo"
          title="Aggiungi item al tavolo"
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-cameriere
                     text-white font-bold text-lg flex items-center justify-center
                     active:scale-95"
        >
          +
        </button>
      )}

      <div className="flex items-center gap-3 flex-wrap pr-10">
        <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="md" />
        {order.turno >= 2 && (
          <span className="text-sm font-bold text-yellow-300 px-2 py-0.5
                           rounded bg-yellow-900/40 border border-yellow-700">
            T{order.turno}
          </span>
        )}
        <span className="text-sm opacity-80">{order.n_persone} pers.</span>
        <span className="text-base">
          🍳{cucOk ? '✅' : '⏳'} 🍺{barOk ? '✅' : '⏳'}
        </span>
        <span className="text-sm opacity-80">⏱ {minuti} min</span>
        <span className="ml-auto font-bold text-lg text-green-400">
          € {Number(order.totale).toFixed(2)}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-gray-400">{ora}</span>
        {!consegnato && stato === 'verde' && onConsegnato && (
          <button
            onClick={(e) => { e.stopPropagation(); onConsegnato(order.id) }}
            className="text-xs px-2 py-1 rounded-lg bg-green-700 font-semibold"
          >
            ✓ Consegnato
          </button>
        )}
        {consegnato && onAnnullaConsegna && (
          <button
            onClick={(e) => { e.stopPropagation(); onAnnullaConsegna(order.id) }}
            className="text-xs px-2 py-1 rounded-lg bg-pannello border border-bordo"
          >
            ↩ Riapri
          </button>
        )}
      </div>
    </div>
  )
}

// -------------------- VISTA NUOVO ORDINE --------------------

function NuovoOrdine({ menu, onCreate, onRefresh, refreshing }) {
  const [tavolo, setTavolo] = useState('')
  const [persone, setPersone] = useState('1')
  const [note, setNote] = useState('')
  const [qty, setQty] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const tavoloRef = useRef(null)

  const itemsArr = useMemo(() => {
    return Object.entries(qty)
      .map(([id, quantita]) => {
        const menuItem = menu.find(m => m.id === id)
        return menuItem ? { menuItem, quantita } : null
      })
      .filter(Boolean)
  }, [qty, menu])

  const totale = itemsArr.reduce(
    (s, it) => s + Number(it.menuItem.prezzo) * it.quantita, 0
  )

  const canSubmit = tavolo && Number(tavolo) > 0 && itemsArr.length > 0 && !submitting

  const submit = async () => {
    if (!canSubmit) return
    const numTavolo = parseInt(tavolo, 10)
    const servizio = getServizioAttuale()
    const dataLocale = getDataServizio()

    // 1) Calcolo turno: cerco il MAX(turno) per questo tavolo+servizio+data
    let nuovoTurno = 1
    try {
      const { startUTC, endUTC } = dataLocaleToUtcRange(dataLocale)
      const { data: prev, error: errMax } = await supabase
        .from('orders')
        .select('turno')
        .eq('numero_tavolo', numTavolo)
        .eq('servizio', servizio)
        .gte('created_at', startUTC)
        .lt('created_at', endUTC)
        .order('turno', { ascending: false })
        .limit(1)
      if (errMax) throw errMax
      const ultimoTurno = prev?.[0]?.turno ?? 0
      if (ultimoTurno >= 1) {
        const volte = ultimoTurno === 1 ? 'volta' : 'volte'
        const okTurno = window.confirm(
          `⚠️ Il tavolo ${numTavolo} è già stato utilizzato ${ultimoTurno} ${volte} in questo servizio (${servizio.toUpperCase()}).\n\nQuesto sarà il turno ${ultimoTurno + 1}. Confermi?`
        )
        if (!okTurno) {
          setTimeout(() => tavoloRef.current?.focus(), 50)
          return
        }
        nuovoTurno = ultimoTurno + 1
      }
    } catch (e) {
      alert('Errore controllo turno: ' + (e.message || e))
      return
    }

    // 2) Conferma pagamento
    const ok = window.confirm(`Pagamento ricevuto: € ${totale.toFixed(2)} — Confermi?`)
    if (!ok) return

    // 3) Crea ordine con servizio + turno
    setSubmitting(true)
    try {
      await onCreate(
        numTavolo,
        Math.max(1, parseInt(persone, 10) || 1),
        itemsArr,
        note || null,
        { servizio, turno: nuovoTurno }
      )
    } catch (e) {
      alert('Errore creazione ordine: ' + (e.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pb-32 mobile-landscape:pb-24">
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
        <span className="text-sm opacity-80">Note (opzionali)</span>
        <input
          type="text" value={note} onChange={e => setNote(e.target.value)}
          className="input-base mt-1" placeholder="Allergie, richieste..."
        />
      </label>

      <MenuSelector items={menu} quantities={qty} onChange={setQty} />

      <div className="fixed bottom-0 left-0 right-0 bg-pannello border-t border-bordo
                      p-3 mobile-landscape:p-2 z-20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm opacity-80">
            {itemsArr.reduce((s, it) => s + it.quantita, 0)} pezzi
          </span>
          <span className="text-xl font-bold">€ {totale.toFixed(2)}</span>
        </div>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="btn-success w-full text-lg"
        >
          {submitting ? 'Invio…' : 'Invia Ordine'}
        </button>
      </div>
    </div>
  )
}

// -------------------- DETTAGLIO ORDINE --------------------

function DettaglioOrdine({ orderId, menu, onAddItems, initialAdding = false }) {
  const [order, setOrder] = useState(null)
  const [adding, setAdding] = useState(initialAdding)
  const [qty, setQty] = useState({})
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data } = await supabase
      .from('orders').select('*, order_items(*)').eq('id', orderId).single()
    setOrder(data)
  }

  useEffect(() => { load() }, [orderId])

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
  }, [orderId])

  if (!order) return <p className="text-center opacity-60 py-10">Caricamento…</p>

  const items = order.order_items || []

  if (adding) {
    const itemsArr = Object.entries(qty)
      .map(([id, quantita]) => {
        const m = menu.find(mm => mm.id === id)
        return m ? { menuItem: m, quantita } : null
      })
      .filter(Boolean)
    const totaleAgg = itemsArr.reduce(
      (s, it) => s + Number(it.menuItem.prezzo) * it.quantita, 0
    )

    return (
      <div className="pb-32 mobile-landscape:pb-24">
        <p className="mb-3 font-semibold">Aggiungi al tavolo {order.numero_tavolo}</p>
        <MenuSelector items={menu} quantities={qty} onChange={setQty} />
        <div className="fixed bottom-0 left-0 right-0 bg-pannello border-t border-bordo
                        p-3 mobile-landscape:p-2 z-20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm opacity-80">
              {itemsArr.reduce((s, it) => s + it.quantita, 0)} pezzi
            </span>
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
      </div>
    )
  }

  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between">
        <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg" />
        <span className="text-2xl font-bold">€ {Number(order.totale).toFixed(2)}</span>
      </div>

      {order.note && (
        <p className="text-sm bg-yellow-900/40 border border-yellow-700 rounded-xl p-2">
          Note: {order.note}
        </p>
      )}

      <Sezione titolo="Cucina" items={cucinaItems} colore="text-cucina" />
      <Sezione titolo="Bar"    items={barItems}    colore="text-bar" />

      <button
        onClick={() => setAdding(true)}
        className="btn-neutral w-full"
      >
        + Aggiungi item
      </button>
    </div>
  )
}

function Sezione({ titolo, items, colore }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className={`font-bold mb-2 ${colore}`}>{titolo}</h3>
      <ul className="space-y-1">
        {items.map(it => (
          <li key={it.id} className="flex items-start justify-between gap-3 card py-2">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              <span className={`badge ${it.pronto ? 'bg-green-700' : 'bg-yellow-600'}`}>
                {it.pronto ? 'Pronto' : 'In attesa'}
              </span>
              <span className="font-semibold break-words whitespace-normal">
                {it.nome_item}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm shrink-0">
              <span className="opacity-80">× {it.quantita}</span>
              <span className="font-bold">
                € {(Number(it.prezzo_unitario) * it.quantita).toFixed(2)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
