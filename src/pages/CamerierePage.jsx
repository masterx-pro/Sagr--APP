import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, ChevronLeft, Plus, CreditCard, Banknote, RefreshCw, Search } from 'lucide-react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import { useImpostazioni } from '../context/ImpostazioniContext.jsx'
import MenuSelector, { flattenQuantities } from '../components/MenuSelector.jsx'
import TableBadge from '../components/TableBadge.jsx'
import RoleHeader, { HeaderIconBtn, HeaderExitBtn } from '../components/RoleHeader.jsx'
import MandataIndicator from '../components/MandataIndicator.jsx'
import { getServizioAttuale } from '../utils/servizio.js'
import {
  groupByMandata,
  getNumeriMandata,
  getStatoMandataDisplay,
  formatCountdownSec,
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
//   'pronto'   -> almeno una mandata ha stato 'in_finestra' (da portare)
//   'attivo'   -> tutto in preparazione/attesa/pre_riscaldo/sbloccata
//   'consegnato' -> tutte le mandate consegnate
function statoCameriereOrdine(items) {
  if (!items || items.length === 0) return 'attivo'
  const tutti = items
  const tuttiConsegnati = tutti.every(i => i.mandata_stato === 'consegnata')
  if (tuttiConsegnati) return 'consegnato'
  const haInFinestra = tutti.some(i => i.mandata_stato === 'in_finestra')
  if (haInFinestra) return 'pronto'
  return 'attivo'
}

const TICK_MS = 30_000

// -------------------- CHIAMATA AUTOMATICA MANDATE (v7) --------------------
//
// Quando l'admin attiva chiamata_automatica_attiva='true' (vedi
// migration_v7.sql), dopo la consegna di M(N) il sistema sblocca da
// solo M(N+1) trascorsi `chiamata_auto_mN_min` minuti. Il timer di
// scadenza per ogni (orderId, N) e' memorizzato in localStorage cosi'
// e' resiliente ai refresh della pagina.

const autoSbloccoKey = (orderId, n) => `auto_sblocco_${orderId}_M${n}`

function isChiamataAutomaticaAttiva(impostazioni) {
  return impostazioni?.chiamata_automatica_attiva === 'true'
}

// Minuti configurati per lo sblocco automatico di M(N+1) dopo M(N).
// Default conservativi se l'impostazione manca.
function getChiamataAutoMinuti(n, impostazioni) {
  const raw = impostazioni?.[`chiamata_auto_m${n}_min`]
  const v = Number(raw)
  if (Number.isFinite(v) && v > 0) return v
  if (n === 1) return 15
  if (n === 2) return 20
  if (n === 3) return 15
  return 15
}

// Restituisce il timestamp piu' recente di consegna per i N items in
// input — solo se TUTTI sono consegnati. Null altrimenti.
function maxConsegnataAt(itemsMandata) {
  if (!itemsMandata?.length) return null
  if (!itemsMandata.every(i => i.mandata_stato === 'consegnata')) return null
  const ts = itemsMandata
    .map(i => i.mandata_consegnata_at)
    .filter(Boolean)
    .map(s => new Date(s).getTime())
    .filter(t => Number.isFinite(t))
  if (!ts.length) return null
  return Math.max(...ts)
}

// -------------------- CAMERIERE PAGE --------------------

export default function CamerierePage({ user, onLogout }) {
  const [view, setView] = useState('list') // 'list' | 'new' | 'detail' | 'payment' | 'riordino'
  const [selectedId, setSelectedId] = useState(null)
  const [menu, setMenu] = useState([])
  const [menuLoading, setMenuLoading] = useState(false)

  // Stato bozza per il flusso "nuovo ordine" / "riordino"
  const [draft, setDraft] = useState(null)
  // { tavolo, persone, nomeCliente, note, qty } dove qty = { itemId: { quantita, mandata } }
  // Flag per distinguere il flusso riordino (back di payment torna a 'riordino', non a 'new')
  const [isRiordino, setIsRiordino] = useState(false)

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
    marcaConsegnata, sbloccaMandata, inviaM4,
    stornaOrdine,
    confermaPagamentoBancomat,
  } = useOrders()

  const { impostazioni } = useImpostazioni()

  const [servizioCorrente, setServizioCorrente] = useState(() => getServizioAttuale(impostazioni))
  const refetchOrders = useCallback(
    () => fetchOrdiniAttivi(servizioCorrente),
    [fetchOrdiniAttivi, servizioCorrente]
  )
  useEffect(() => { refetchOrders() }, [refetchOrders])

  // Ricalcola servizio quando arrivano le impostazioni
  useEffect(() => {
    const nuovo = getServizioAttuale(impostazioni)
    if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
  }, [impostazioni])

  // Auto-switch pranzo/cena
  useEffect(() => {
    const interval = setInterval(() => {
      const nuovo = getServizioAttuale(impostazioni)
      if (nuovo !== servizioCorrente) setServizioCorrente(nuovo)
    }, 60_000)
    return () => clearInterval(interval)
  }, [servizioCorrente, impostazioni])

  const loadMenu = useCallback(async () => {
    setMenuLoading(true)
    const { data } = await supabase
      .from('menu_items').select('*')
      .eq('attivo', true).order('ordine')
    setMenu(data || [])
    setMenuLoading(false)
  }, [])
  useEffect(() => { loadMenu() }, [loadMenu])
  useEffect(() => { if (view === 'new' || view === 'riordino') loadMenu() }, [view, loadMenu])

  // Realtime
  useEffect(() => {
    // order_items: solo UPDATE (mandata_stato). Gli INSERT arrivano via
    // l'evento INSERT/UPDATE su orders (refetch include order_items).
    // orders: '*' filtrato per servizio corrente (anche INSERT per
    // mostrare ordini di altri camerieri).
    const channel = supabase
      .channel(`cameriere-feed-${servizioCorrente}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_items' },
        () => refetchOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `servizio=eq.${servizioCorrente}` },
        () => refetchOrders())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [refetchOrders, servizioCorrente])

  // Notifica sonora: quando un ordine ha NUOVE mandate 'in_finestra' (v5)
  const lastReadyRef = useRef(null)
  useEffect(() => {
    const readySet = new Set()
    for (const o of orders) {
      const groups = groupByMandata(o.order_items || [])
      for (const m of Object.keys(groups)) {
        if (getStatoMandataDisplay(groups[m]) === 'in_finestra') {
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

  // Chiamata automatica mandate (v7): scrive in localStorage le scadenze
  // per ogni mandata consegnata e poi sblocca M(N+1) quando scade.
  // Eseguito ad ogni cambio di `orders` (cosi' partono nuovi timer non
  // appena marchi M(N) consegnata) e a un interval di 30s.
  const chiamataAutoAttiva = isChiamataAutomaticaAttiva(impostazioni)

  // Versione che bumpa al cambio del localStorage cosi' i countdown in
  // lista si aggiornano alla scrittura/cancellazione delle scadenze.
  const [autoSbloccoVersion, setAutoSbloccoVersion] = useState(0)

  const aggiornaScadenzeAuto = useCallback(() => {
    if (!chiamataAutoAttiva) return false
    let mutato = false
    for (const o of orders) {
      if (o.stato !== 'confermato') continue
      const items = o.order_items || []
      for (const n of [1, 2, 3]) {
        const itemsN = items.filter(i => i.mandata === n)
        if (itemsN.length === 0) continue
        const itemsNext = items.filter(i => i.mandata === n + 1)
        if (itemsNext.length === 0) continue

        const key = autoSbloccoKey(o.id, n)
        const nextDaSbloccare = itemsNext.some(i =>
          i.mandata_stato === 'in_attesa' || i.mandata_stato === 'pre_riscaldo'
        )
        if (!nextDaSbloccare) {
          if (localStorage.getItem(key) != null) {
            localStorage.removeItem(key)
            mutato = true
          }
          continue
        }
        const baseTs = maxConsegnataAt(itemsN)
        if (baseTs == null) continue
        const scadenza = baseTs + getChiamataAutoMinuti(n, impostazioni) * 60_000
        const cur = localStorage.getItem(key)
        if (cur == null || Number(cur) !== scadenza) {
          localStorage.setItem(key, String(scadenza))
          mutato = true
        }
      }
    }
    return mutato
  }, [orders, impostazioni, chiamataAutoAttiva])

  useEffect(() => {
    if (aggiornaScadenzeAuto()) setAutoSbloccoVersion(v => v + 1)
  }, [aggiornaScadenzeAuto])

  // Interval: ogni 30s controlla se qualche timer e' scaduto e
  // sblocca automaticamente la mandata successiva.
  const ordersRef = useRef(orders)
  useEffect(() => { ordersRef.current = orders }, [orders])

  useEffect(() => {
    if (!chiamataAutoAttiva) return
    let cancelled = false

    const tick = async () => {
      const now = Date.now()
      const list = ordersRef.current || []
      let didSomething = false
      for (const o of list) {
        if (o.stato !== 'confermato') continue
        for (const n of [1, 2, 3]) {
          const key = autoSbloccoKey(o.id, n)
          const raw = localStorage.getItem(key)
          if (!raw) continue
          const scadenza = Number(raw)
          if (!Number.isFinite(scadenza)) { localStorage.removeItem(key); continue }
          if (now < scadenza) continue
          try {
            await sbloccaMandata(o.id, n + 1)
            localStorage.removeItem(key)
            didSomething = true
          } catch (e) {
            console.warn('Auto-sblocco fallito', { orderId: o.id, mandata: n + 1 }, e)
          }
        }
      }
      if (didSomething && !cancelled) {
        setAutoSbloccoVersion(v => v + 1)
        await refetchOrders()
      }
    }

    tick()
    const iv = setInterval(tick, 30_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [chiamataAutoAttiva, sbloccaMandata, refetchOrders])

  // Mappa orderId -> { mandataNext: scadenzaTs }. Letta da localStorage,
  // utile a card lista (countdown grigio) e dettaglio (override).
  const autoSbloccoMap = useMemo(() => {
    const m = new Map()
    if (!chiamataAutoAttiva) return m
    for (const o of orders) {
      const per = {}
      for (const n of [1, 2, 3]) {
        const raw = localStorage.getItem(autoSbloccoKey(o.id, n))
        if (!raw) continue
        const ts = Number(raw)
        if (!Number.isFinite(ts)) continue
        per[n + 1] = ts
      }
      if (Object.keys(per).length > 0) m.set(o.id, per)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, chiamataAutoAttiva, autoSbloccoVersion])

  // Protezioni navigazione
  useEffect(() => {
    if (view !== 'new' && view !== 'payment' && view !== 'riordino') return
    const onBeforeUnload = (e) => {
      const msg = view === 'riordino'
        ? 'Hai un riordino in corso. Sei sicuro di voler uscire?'
        : 'Hai un ordine in corso. Sei sicuro di voler uscire?'
      e.preventDefault()
      e.returnValue = msg
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
    if (view === 'new' || view === 'payment' || view === 'riordino') {
      window.history.pushState(null, '', window.location.href)
      const onPop = () => {
        const msg = view === 'riordino'
          ? 'Vuoi annullare il riordino?'
          : 'Hai un ordine in corso. Vuoi annullare e tornare indietro?'
        const ok = window.confirm(msg)
        if (ok) { setDraft(null); setIsRiordino(false); setView('list') }
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
        if (view === 'payment') {
          setView(isRiordino ? 'riordino' : 'new')
          return
        }
        setView('list'); setSelectedId(null); setDraft(null); setIsRiordino(false)
      }}
      className="inline-flex items-center justify-center w-10 h-10 rounded-[14px]
                 bg-white/15 text-text active:scale-95 transition-transform"
      aria-label="Indietro"
    >
      <ChevronLeft size={22} />
    </button>
  )

  // Conta le mandate in finestra (v5) da portare al tavolo: badge campana
  const readyCount = useMemo(() => {
    let n = 0
    for (const o of orders) {
      if (o.stato === 'stornato' || o.stato === 'attesa_cassa' || o.stato === 'attesa_bancomat') continue
      const items = o.order_items || []
      if (items.some(i => i.mandata_stato === 'in_finestra')) n++
    }
    return n
  }, [orders])

  const titleMap = {
    list:     'Mappa tavoli',
    new:      'Nuovo ordine',
    riordino: "Aggiungi all'ordine",
    payment:  'Pagamento',
    detail:   'Dettaglio',
  }
  const subtitleMap = {
    list: `Ciao, ${user.nome}`,
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <RoleHeader
        role="cameriere"
        title={titleMap[view] || 'Cameriere'}
        subtitle={subtitleMap[view]}
        impostazioni={impostazioni}
        showBadge={view !== 'new'}
        leftAction={onLeftAction}
        right={
          <>
            <HeaderIconBtn
              onClick={() => {
                if (!soundEnabled) {
                  const ctx = getAudioCtx()
                  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
                }
                setSoundEnabled(s => !s)
              }}
              ariaLabel={soundEnabled ? 'Disattiva suono' : 'Attiva suono'}
              title={soundEnabled ? 'Disattiva suono' : 'Attiva suono'}
              badge={view === 'list' && readyCount > 0 ? readyCount : null}
            >
              {soundEnabled ? <Bell size={20} /> : <BellOff size={20} />}
            </HeaderIconBtn>
            <HeaderExitBtn onClick={onLogout} />
          </>
        }
      />

      <main className="flex-1 p-4">
        {view === 'list' && (
          <ListaTavoli
            orders={orders}
            chiamataAutoAttiva={chiamataAutoAttiva}
            autoSbloccoMap={autoSbloccoMap}
            onNew={() => setView('new')}
            onSelect={(id) => { setSelectedId(id); setView('detail') }}
            onSblocca={async (orderId, mandataNum) => {
              try {
                await sbloccaMandata(orderId, mandataNum)
                // Pulisci eventuale chiave auto residua per questo sblocco
                localStorage.removeItem(autoSbloccoKey(orderId, mandataNum - 1))
                setAutoSbloccoVersion(v => v + 1)
                await refetchOrders()
              } catch (e) {
                alert('Errore sblocco mandata: ' + (e.message || e))
              }
            }}
            onRiordino={(order) => {
              const nomeBase = (order.nome_cliente || '').replace(/\s*\(riordino\)\s*$/i, '').trim()
              setDraft({
                tavolo: String(order.numero_tavolo),
                persone: '1',
                nomeCliente: nomeBase ? `${nomeBase} (riordino)` : '(riordino)',
                note: null,
                qty: {},
              })
              setIsRiordino(true)
              setView('riordino')
            }}
            onConfermaBancomat={async (orderId) => {
              await confermaPagamentoBancomat(orderId)
              await refetchOrders()
            }}
            onConsegnata={async (orderId, mandataNum, categoria) => {
              await marcaConsegnata(orderId, mandataNum, categoria)
              await refetchOrders()
            }}
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
        {view === 'riordino' && draft && (
          <RiordinoRapido
            menu={menu}
            draft={draft}
            onRefresh={loadMenu}
            refreshing={menuLoading}
            onProceedToPayment={(qty) => {
              setDraft({ ...draft, qty })
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
              const servizio = getServizioAttuale(impostazioni)
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
                const eraRiordino = isRiordino
                setDraft(null)
                setIsRiordino(false)
                setView('list')
                if (pagamento === 'contanti') {
                  const prefix = eraRiordino ? "Aggiunta all'ordine in cassa:\n" : 'Invia il cliente in cassa con:\n'
                  alert(`${prefix}Tav. ${draft.tavolo} · ${draft.nomeCliente}`)
                } else if (pagamento === 'bancomat') {
                  alert(
                    `Procedi con il POS per Tav. ${draft.tavolo} · ${draft.nomeCliente}.\n` +
                    `Ricordati di premere "Pagamento effettuato" appena la transazione e' confermata: ` +
                    `solo allora cucina e bar partono.`
                  )
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
            chiamataAutoAttiva={chiamataAutoAttiva}
            autoSbloccoPerMandata={autoSbloccoMap.get(selectedId) || {}}
            onAddItems={async (items, opts) => {
              await addItemsToOrder(selectedId, items, opts)
              await refetchOrders()
            }}
            onMandataConsegnata={async (mandataNum, categoria) => {
              await marcaConsegnata(selectedId, mandataNum, categoria)
              await refetchOrders()
            }}
            onSbloccaMandata={async (mandataNum) => {
              await sbloccaMandata(selectedId, mandataNum)
              // Forza override: cancella eventuale timer auto e bumpa la version
              localStorage.removeItem(autoSbloccoKey(selectedId, mandataNum - 1))
              setAutoSbloccoVersion(v => v + 1)
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
            onConfermaBancomat={async () => {
              await confermaPagamentoBancomat(selectedId)
              await refetchOrders()
            }}
          />
        )}
      </main>
    </div>
  )
}

// -------------------- LISTA TAVOLI --------------------

function ListaTavoli({ orders, onNew, onSelect, onRiordino, onSblocca, onConfermaBancomat, onConsegnata, chiamataAutoAttiva, autoSbloccoMap }) {
  const [filtro, setFiltro] = useState('tutti') // 'tutti' | 'pronti' | 'attivi' | 'daPagare'

  const pronti    = []
  const attivi    = []
  const daPagare  = []   // attesa_cassa (contanti) + attesa_bancomat (POS)
  const stornati  = []

  for (const o of orders) {
    if (o.stato === 'attesa_cassa')    { daPagare.push(o); continue }
    if (o.stato === 'attesa_bancomat') { daPagare.push(o); continue }
    if (o.stato === 'stornato')        { stornati.push(o); continue }
    const stato = statoCameriereOrdine(o.order_items || [])
    if (stato === 'pronto') pronti.push(o)
    else attivi.push(o)
  }

  const totali = {
    tutti: orders.length,
    pronti: pronti.length,
    attivi: attivi.length,
    daPagare: daPagare.length,
  }

  const tavoliPronti = pronti.map(o => o.numero_tavolo).slice(0, 6)

  // Lista ordinata per priorità: pronto → attivo → da pagare → stornato
  const sorted = [...pronti, ...attivi, ...daPagare, ...stornati]
  const filtered = (() => {
    if (filtro === 'pronti')   return pronti
    if (filtro === 'attivi')   return attivi
    if (filtro === 'daPagare') return daPagare
    return sorted
  })()

  return (
    <div className="space-y-4 pb-24">
      {/* Banner "PRONTI DA PORTARE" */}
      {pronti.length > 0 && (
        <button
          onClick={() => setFiltro('pronti')}
          className="w-full rounded-card-lg px-4 py-3 text-left shadow-md
                     bg-gradient-to-br from-success to-successInk text-text
                     active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center gap-3">
            <span className="relative inline-flex w-3 h-3">
              <span className="absolute inset-0 rounded-full bg-text animate-pulseDot" />
              <span className="relative inline-block w-3 h-3 rounded-full bg-text" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-extrabold tracking-[1.4px] uppercase opacity-90">
                🔔 Pronti da portare
              </div>
              <div className="text-[17px] font-extrabold tabular-nums leading-tight">
                {pronti.length} tavol{pronti.length === 1 ? 'o' : 'i'}
                {tavoliPronti.length > 0 && (
                  <span className="text-[14px] font-bold opacity-80 ml-2">
                    · {tavoliPronti.map(t => `#${t}`).join(' ')}
                    {pronti.length > tavoliPronti.length && '…'}
                  </span>
                )}
              </div>
            </div>
            <ChevronLeft size={20} className="rotate-180 opacity-80" />
          </div>
        </button>
      )}

      {/* Filter strip */}
      <div className="grid grid-cols-4 gap-2">
        <FilterChip
          active={filtro === 'tutti'} onClick={() => setFiltro('tutti')}
          label="Tutti"  count={totali.tutti}  dotCls="bg-textSoft"
        />
        <FilterChip
          active={filtro === 'pronti'} onClick={() => setFiltro('pronti')}
          label="Pronti" count={totali.pronti} dotCls="bg-success"
        />
        <FilterChip
          active={filtro === 'attivi'} onClick={() => setFiltro('attivi')}
          label="In corso" count={totali.attivi} dotCls="bg-warning"
        />
        <FilterChip
          active={filtro === 'daPagare'} onClick={() => setFiltro('daPagare')}
          label="Da pagare" count={totali.daPagare} dotCls="bg-gold"
        />
      </div>

      {orders.length === 0 && (
        <p className="text-center text-textSoft py-16 font-semibold">
          Nessun ordine attivo
        </p>
      )}

      {orders.length > 0 && filtered.length === 0 && (
        <p className="text-center text-textMute py-10 font-semibold">
          Nessun tavolo in questo filtro
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {filtered.map(o => (
          <CompactOrderCard
            key={o.id}
            order={o}
            onSelect={onSelect}
            onRiordino={onRiordino}
            onSblocca={onSblocca}
            onConfermaBancomat={onConfermaBancomat}
            onConsegnata={onConsegnata}
            chiamataAutoAttiva={chiamataAutoAttiva}
            autoSbloccoPerMandata={(autoSbloccoMap && autoSbloccoMap.get(o.id)) || {}}
          />
        ))}
      </ul>

      {/* FAB Nuovo Tavolo */}
      <button
        onClick={onNew}
        aria-label="Nuovo tavolo"
        title="Nuovo tavolo"
        className="fixed bottom-5 right-5 z-30
                   inline-flex items-center gap-2 pl-4 pr-5 py-3 rounded-fab
                   bg-gradient-to-br from-gold to-goldDeep text-bg
                   font-extrabold text-base shadow-cta active:scale-95 transition-transform"
      >
        <Plus size={22} strokeWidth={3} />
        Nuovo Tavolo
      </button>
    </div>
  )
}

function FilterChip({ active, onClick, label, count, dotCls }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-btn
                  font-extrabold text-[11px] uppercase tracking-[0.6px]
                  active:scale-95 transition-transform
                  ${active
                    ? 'bg-surfaceHi text-text border border-gold/60 shadow-sm'
                    : 'bg-surface text-textSoft border border-borderSoft'}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotCls}`} />
        {label}
      </span>
      <span className="text-[14px] font-extrabold tabular-nums text-text leading-none">
        {count}
      </span>
    </button>
  )
}

// -------------------- COMPACT ORDER CARD --------------------

// stato globale ordine → meta visivo (border-l + banner)
function metaStatoOrdine(order, items) {
  if (order.stato === 'stornato') {
    return {
      borderCls: 'border-l-danger',
      bannerCls: 'bg-dangerSoft text-danger',
      label: 'STORNATO',
      pulseBanner: false,
    }
  }
  if (order.stato === 'attesa_cassa') {
    return {
      borderCls: 'border-l-gold',
      bannerCls: 'bg-goldSoft text-gold',
      label: '💵 ATTESA CASSA',
      pulseBanner: false,
    }
  }
  if (order.stato === 'attesa_bancomat') {
    return {
      borderCls: 'border-l-info',
      bannerCls: 'bg-infoSoft text-info',
      label: '💳 PAGAMENTO BANCOMAT',
      pulseBanner: true,
    }
  }
  const stato = statoCameriereOrdine(items)
  if (stato === 'pronto') {
    return {
      borderCls: 'border-l-success',
      bannerCls: 'bg-successSoft text-success',
      label: '🟢 PRONTI DA PORTARE',
      pulseBanner: true,
    }
  }
  if (stato === 'consegnato') {
    return {
      borderCls: 'border-l-textMute',
      bannerCls: 'bg-[rgba(196,168,130,0.08)] text-textMute',
      label: '✅ COMPLETATO',
      pulseBanner: false,
    }
  }
  const urgente = items.some(i => i.mandata_stato === 'sbloccata')
  if (urgente) {
    return {
      borderCls: 'border-l-danger',
      bannerCls: 'bg-dangerSoft text-danger',
      label: '🔴 URGENTE · ESCI SUBITO',
      pulseBanner: true,
    }
  }
  const inCorso = items.some(i => i.mandata_stato === 'in_preparazione')
  if (inCorso) {
    return {
      borderCls: 'border-l-warning',
      bannerCls: 'bg-warningSoft text-warning',
      label: '🟡 IN CORSO',
      pulseBanner: false,
    }
  }
  // pre_riscaldo e' info interna alla cucina: per il cameriere = IN ATTESA.
  return {
    borderCls: 'border-l-textSoft',
    bannerCls: 'bg-[rgba(196,168,130,0.14)] text-textSoft',
    label: '⏳ IN ATTESA',
    pulseBanner: false,
  }
}

function statoMandataToIndicator(stato) {
  // L'aggregato di getStatoMandataDisplay (v5) usa direttamente i nomi
  // degli stati salvati su DB, quindi passa-through con un fallback.
  if (stato === 'consegnata')       return 'consegnata'
  if (stato === 'in_finestra')      return 'in_finestra'
  if (stato === 'in_preparazione')  return 'in_preparazione'
  if (stato === 'sbloccata')        return 'sbloccata'
  if (stato === 'pre_riscaldo')     return 'pre_riscaldo'
  if (stato === 'in_pausa')         return 'in_pausa'
  return 'in_attesa'
}

// Variante per la card lista: la mandata successiva si "sblocca" SOLO
// quando tutta la precedente e' CONSEGNATA (non basta in_finestra), in
// modo che il cameriere prima porti al tavolo M(N-1) — premendo i
// pulsanti "Ho portato MX cucina/bar" — e POI veda apparire il pulsante
// "Esci con MN". Stessa firma di prossimaMandataSbloccabile.
function prossimaMandataSbloccabileLista(items) {
  const cucinaGroups = groupByMandata((items || []).filter(i => i.categoria === 'cucina'))
  const barGroups    = groupByMandata((items || []).filter(i => i.categoria === 'bar'))

  const numeri = [1, 2, 3, 4].filter(n => cucinaGroups[n] || barGroups[n])
  for (const n of numeri) {
    const itemsN = [...(cucinaGroups[n] || []), ...(barGroups[n] || [])]
    const haNonSbloccata = itemsN.some(i =>
      i.mandata_stato === 'in_attesa' || i.mandata_stato === 'pre_riscaldo'
    )
    if (!haNonSbloccata) continue

    if (n > 1) {
      const itemsPrev = [...(cucinaGroups[n - 1] || []), ...(barGroups[n - 1] || [])]
      if (itemsPrev.length > 0) {
        // Stretta: nessun item della mandata precedente puo' essere ancora
        // in_finestra (il cameriere deve averli portati al tavolo).
        const prevTuttaConsegnata = itemsPrev.every(i => i.mandata_stato === 'consegnata')
        if (!prevTuttaConsegnata) continue
      }
    }
    return n
  }
  return null
}

// Restituisce le coppie (mandataNum, categoria) attualmente in_finestra,
// usate per generare i pulsanti "Ho portato MX cucina/bar al tavolo".
function getConsegneInFinestra(items) {
  const out = []
  for (const n of [1, 2, 3, 4]) {
    if ((items || []).some(i =>
      i.mandata === n && i.categoria === 'cucina' && i.mandata_stato === 'in_finestra'
    )) out.push({ mandataNum: n, categoria: 'cucina' })
    if ((items || []).some(i =>
      i.mandata === n && i.categoria === 'bar' && i.mandata_stato === 'in_finestra'
    )) out.push({ mandataNum: n, categoria: 'bar' })
  }
  return out
}

// Restituisce il numero della prossima mandata cucina sbloccabile
// (cioe' M(N-1) tutta in_finestra/consegnata, oppure N=1), o null
// se non c'e' nulla da sbloccare. M4 e' SEMPRE sbloccata manualmente
// dal cameriere a fine pasto (caffe'/dolci/amari) — non automatico.
function prossimaMandataSbloccabile(items) {
  const cucinaGroups = groupByMandata((items || []).filter(i => i.categoria === 'cucina'))
  // Considera anche items M4 bar (caffe'/amari) che vivono in barGroups.
  // Per le M 1..3 ci basta cucina; per M4 includiamo anche bar.
  const barGroups = groupByMandata((items || []).filter(i => i.categoria === 'bar'))

  const numeri = [1, 2, 3, 4].filter(n => cucinaGroups[n] || barGroups[n])
  for (const n of numeri) {
    const itemsN = [...(cucinaGroups[n] || []), ...(barGroups[n] || [])]
    const haNonSbloccata = itemsN.some(i =>
      i.mandata_stato === 'in_attesa' || i.mandata_stato === 'pre_riscaldo'
    )
    if (!haNonSbloccata) continue

    if (n > 1) {
      const itemsPrev = cucinaGroups[n - 1] || []
      if (itemsPrev.length > 0) {
        const prevPronta = itemsPrev.every(i =>
          i.mandata_stato === 'in_finestra' || i.mandata_stato === 'consegnata'
        )
        if (!prevPronta) continue
      }
    }
    return n
  }
  return null
}

function CompactOrderCard({ order, onSelect, onRiordino, onSblocca, onConfermaBancomat, onConsegnata, chiamataAutoAttiva, autoSbloccoPerMandata }) {
  const items = order.order_items || []
  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')
  const cucinaGroups = groupByMandata(cucinaItems)
  const barGroups    = groupByMandata(barItems)
  const cucinaNumeri = getNumeriMandata(cucinaItems)
  const barNumeri    = getNumeriMandata(barItems)

  const minuti = Math.max(0, Math.floor((Date.now() - new Date(order.created_at)) / 60000))
  const meta = metaStatoOrdine(order, items)
  const isContanti = order.tipo_pagamento === 'contanti'

  // Usa la variante stretta: "Esci con M(N)" appare SOLO quando M(N-1)
  // e' completamente consegnata. Cosi' i pulsanti "Ho portato MX" hanno
  // priorita' sullo sblocco della mandata successiva.
  const prossimaSblocco = order.stato === 'confermato'
    ? prossimaMandataSbloccabileLista(items)
    : null

  // Feedback locale per il pulsante "Pagamento effettuato" (1s verde dopo OK).
  const [busyBancomat, setBusyBancomat] = useState(false)
  const [bancomatConfirmed, setBancomatConfirmed] = useState(false)
  const showBancomatBtn = (order.stato === 'attesa_bancomat' || bancomatConfirmed) && onConfermaBancomat

  const handleConfermaBancomat = async (e) => {
    e.stopPropagation()
    const nome = order.nome_cliente ? ` · ${order.nome_cliente}` : ''
    const ok = window.confirm(
      `Confermi pagamento bancomat di € ${Number(order.totale).toFixed(2)} per Tav.${order.numero_tavolo}${nome}?`
    )
    if (!ok) return
    setBusyBancomat(true)
    try {
      await onConfermaBancomat(order.id)
      setBancomatConfirmed(true)
      setTimeout(() => setBancomatConfirmed(false), 1000)
    } catch (err) {
      alert('Errore: ' + (err.message || err))
    } finally {
      setBusyBancomat(false)
    }
  }

  // Pulsanti consegna separati per (categoria, mandata) in_finestra.
  // `justDelivered` mantiene visibile per 1.5s il feedback "✓ Consegnata!"
  // anche dopo che i dati sono refreshati (l'item non e' piu' in_finestra).
  const [busyDelivery, setBusyDelivery] = useState(false)
  const [justDelivered, setJustDelivered] = useState(null) // { mandataNum, categoria }

  const consegne = getConsegneInFinestra(items)
  const renderedConsegne = consegne.map(c => ({ ...c }))
  if (justDelivered) {
    const idx = renderedConsegne.findIndex(c =>
      c.categoria === justDelivered.categoria && c.mandataNum === justDelivered.mandataNum
    )
    if (idx >= 0) renderedConsegne[idx].feedback = true
    else renderedConsegne.push({ ...justDelivered, feedback: true })
  }

  const handleConsegna = async (e, c) => {
    e.stopPropagation()
    if (busyDelivery || !onConsegnata) return
    setBusyDelivery(true)
    try {
      await onConsegnata(order.id, c.mandataNum, c.categoria)
      setJustDelivered({ mandataNum: c.mandataNum, categoria: c.categoria })
      setTimeout(() => setJustDelivered(null), 1500)
    } catch (err) {
      alert('Errore: ' + (err.message || err))
    } finally {
      setBusyDelivery(false)
    }
  }

  return (
    <li
      onClick={() => onSelect && onSelect(order.id)}
      className={`cursor-pointer active:scale-[0.98] transition-transform
                  bg-surface border border-borderSoft border-l-4 ${meta.borderCls}
                  rounded-card p-3 shadow-sm flex flex-col gap-2`}
    >
      {/* row 1 */}
      <div className="flex items-center gap-2.5">
        <div className={`w-11 h-11 rounded-btn flex items-center justify-center
                         text-[20px] font-extrabold tabular-nums shrink-0
                         ${meta.bannerCls}`}>
          {order.numero_tavolo}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-bold leading-tight text-text truncate">
            {order.nome_cliente || `Tav. ${order.numero_tavolo}`}
          </div>
          <div className="flex items-center gap-2.5 mt-[3px] text-textSoft text-[12.5px] font-semibold">
            <span>👥 {order.n_persone || 1}</span>
            {minuti > 0 && (
              <span className={minuti > 30 ? 'text-warning' : ''}>
                ⏱ {minuti}m
              </span>
            )}
            {order.turno > 1 && (
              <span className="text-gold">T{order.turno}</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[19px] font-extrabold tabular-nums text-text leading-none">
            € {Number(order.totale).toFixed(2)}
          </div>
          {order.tipo_pagamento && (
            <span className={`inline-flex items-center gap-1 mt-1.5 px-1.5 py-[3px] rounded-badge
                              text-[10.5px] font-extrabold tracking-wide
                              ${isContanti
                                ? 'bg-successSoft text-success'
                                : 'bg-infoSoft text-info'}`}>
              {isContanti ? <Banknote size={11} /> : <CreditCard size={11} />}
              {isContanti ? 'CONT' : 'BANC'}
            </span>
          )}
        </div>
      </div>

      {/* row 2: mandata indicators */}
      {(cucinaNumeri.length > 0 || barNumeri.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {cucinaNumeri.map(n => (
            <MandataIndicator
              key={`c-${n}`}
              source="cucina"
              mandata={n}
              stato={statoMandataToIndicator(getStatoMandataDisplay(cucinaGroups[n]))}
            />
          ))}
          {barNumeri.map(n => {
            const sDisplay = getStatoMandataDisplay(barGroups[n])
            // Bar M4 (caffe' + amari + dolci) e' "bloccata" finche' il cameriere
            // non preme "Sblocca M4". Le altre mandate bar partono automatiche.
            const isBarBlocked = n === 4 && barGroups[n].every(i => i.mandata_stato === 'in_attesa')
            return (
              <MandataIndicator
                key={`b-${n}`}
                source="bar"
                mandata={n}
                stato={isBarBlocked ? 'bloccata' : statoMandataToIndicator(sDisplay)}
              />
            )
          })}
        </div>
      )}

      {/* In attesa di conferma bancomat: pulsante unico al posto di banner
          / consegna / sblocco / aggiungi. */}
      {showBancomatBtn && (
        <button
          type="button"
          disabled={busyBancomat || bancomatConfirmed}
          onClick={handleConfermaBancomat}
          className={`w-full min-h-[48px] rounded-[10px] px-3 font-extrabold text-[13px] uppercase tracking-[0.6px]
                      inline-flex items-center justify-center gap-2
                      active:scale-95 transition-transform
                      disabled:active:scale-100
                      ${bancomatConfirmed
                        ? 'bg-success text-bg shadow-cta'
                        : 'bg-info text-bg shadow-cta'}`}
        >
          {bancomatConfirmed
            ? '✓ Confermato!'
            : (busyBancomat ? 'Conferma…' : '💳 Pagamento effettuato →')}
        </button>
      )}

      {!showBancomatBtn && (
        <>
          {/* Pulsanti consegna separati per ogni (categoria, mandata) in_finestra.
              Feedback giallo "✓ Consegnata!" per 1.5s dopo il click. */}
          {renderedConsegne.map(c => {
            const key = `${c.categoria}-${c.mandataNum}`
            const label = c.categoria === 'cucina' ? 'cucina' : 'bar'
            return (
              <button
                key={key}
                type="button"
                disabled={c.feedback || busyDelivery}
                onClick={(e) => handleConsegna(e, c)}
                className={`w-full min-h-[48px] rounded-btn font-extrabold text-[14px] tracking-[0.3px]
                            active:scale-95 transition-transform inline-flex items-center justify-center gap-2
                            disabled:active:scale-100
                            ${c.feedback
                              ? 'bg-warning text-bg'
                              : 'bg-success text-bg shadow-[0_3px_0_#3F2A1F]'}`}
              >
                {c.feedback
                  ? '✓ Consegnata!'
                  : `✅ Ho portato M${c.mandataNum} ${label} al tavolo`}
              </button>
            )
          })}

          {/* Pulsante sblocco mandata successiva. Visibile SOLO quando la
              mandata precedente e' interamente consegnata (vedi
              prossimaMandataSbloccabileLista). Se la chiamata automatica
              e' attiva e il timer non e' ancora scaduto, il pulsante e'
              grigio con countdown e non cliccabile (l'override resta
              disponibile dal dettaglio). */}
          {prossimaSblocco != null && onSblocca && (
            <SbloccoPulsante
              order={order}
              prossimaSblocco={prossimaSblocco}
              chiamataAutoAttiva={chiamataAutoAttiva}
              autoScadenza={autoSbloccoPerMandata?.[prossimaSblocco] ?? null}
              onSblocca={onSblocca}
            />
          )}

          {/* Banner stato (PRONTI DA PORTARE / IN CORSO / IN ATTESA / ecc) */}
          <div className={`flex items-center justify-center px-2.5 py-1.5 rounded-[10px]
                           text-[11px] font-extrabold uppercase tracking-[0.6px] ${meta.bannerCls}`}>
            <span className="inline-flex items-center gap-1.5">
              {meta.pulseBanner && (
                <span className="relative inline-block w-2 h-2">
                  <span className="absolute inset-0 rounded-full bg-current animate-pulseDot" />
                  <span className="relative inline-block w-2 h-2 rounded-full bg-current" />
                </span>
              )}
              {meta.label}
            </span>
          </div>

          {/* Pulsante "+ Aggiungi all'ordine" (solo se l'ordine e' confermato) */}
          {onRiordino && order.stato === 'confermato' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRiordino(order) }}
              className="w-full min-h-[44px] rounded-btn border border-info/50 bg-infoSoft text-info
                         font-extrabold text-[13px] uppercase tracking-[0.4px]
                         active:scale-95 transition-transform"
              title="Aggiungi voci all'ordine"
            >
              + Aggiungi all'ordine
            </button>
          )}
        </>
      )}
    </li>
  )
}

// Pulsante "Esci con MX" della card lista. Quando la chiamata automatica
// e' attiva E c'e' una scadenza futura, mostra countdown e non e' cliccabile:
// il cameriere deve aspettare l'auto-sblocco oppure forzare dal dettaglio.
function SbloccoPulsante({ order, prossimaSblocco, chiamataAutoAttiva, autoScadenza, onSblocca }) {
  const inAuto = chiamataAutoAttiva && autoScadenza != null && autoScadenza > Date.now()

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!inAuto) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [inAuto])

  const secondsLeft = inAuto ? Math.max(0, Math.floor((autoScadenza - now) / 1000)) : 0
  const baseLabel = prossimaSblocco === 4
    ? '☕ Sblocca M4 (dolci · caffè · amari)'
    : `🍽️ Esci con M${prossimaSblocco}`

  if (inAuto) {
    return (
      <button
        type="button"
        disabled
        onClick={(e) => e.stopPropagation()}
        className="w-full min-h-[48px] rounded-btn font-extrabold text-[14px] tracking-[0.3px]
                   bg-surfaceElev text-textSoft border border-borderSoft
                   inline-flex items-center justify-center gap-2 cursor-not-allowed"
        title="Sblocco automatico programmato — puoi forzare dal dettaglio"
      >
        {baseLabel} · {formatCountdownSec(secondsLeft)}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSblocca(order.id, prossimaSblocco) }}
      className="w-full min-h-[48px] rounded-btn font-extrabold text-[15px] tracking-[0.3px]
                 bg-gradient-to-br from-gold to-goldDeep text-bg shadow-cta
                 active:scale-95 transition-transform inline-flex items-center justify-center gap-2"
    >
      {baseLabel} →
    </button>
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

  const personeNum = parseInt(persone, 10)
  const personeValide = !isNaN(personeNum) && personeNum >= 1 && personeNum <= 30

  const canSubmit =
    tavolo && Number(tavolo) > 0
    && nomeCliente.trim().length > 0
    && itemsArr.length > 0
    && personeValide

  const submit = () => {
    if (!canSubmit) {
      if (!personeValide) {
        alert('Numero persone non valido (min 1, max 30)')
        return
      }
      return
    }
    onProceedToPayment({ tavolo, persone, nomeCliente, note, qty })
  }

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-extrabold tracking-[1.4px] uppercase text-textSoft">
          Step 1 · Dati tavolo
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Ricarica menu"
          title="Ricarica menu"
          className={`w-10 h-10 rounded-btn bg-surface border border-border text-textSoft
                      flex items-center justify-center active:scale-95 transition-transform
                      disabled:opacity-50 ${refreshing ? 'animate-spin' : ''}`}
        >
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="text-[12px] font-semibold text-textSoft uppercase tracking-wider">N. Tavolo</span>
          <input
            ref={tavoloRef}
            type="number" inputMode="numeric" min="1"
            value={tavolo} onChange={e => setTavolo(e.target.value)}
            className="input-base mt-1 tabular-nums" placeholder="12"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-textSoft uppercase tracking-wider">N. Persone</span>
          <input
            type="number" inputMode="numeric" min="1" max="30"
            value={persone} onChange={e => setPersone(e.target.value)}
            className="input-base mt-1 tabular-nums"
          />
        </label>
      </div>

      <label className="block mb-3">
        <span className="text-[12px] font-semibold text-textSoft uppercase tracking-wider">Nome cliente *</span>
        <input
          type="text"
          value={nomeCliente}
          onChange={e => setNomeCliente(e.target.value)}
          className="input-base mt-1"
          placeholder="Capotavola (es. Mattia)"
          required
        />
      </label>

      <label className="block mb-4">
        <span className="text-[12px] font-semibold text-textSoft uppercase tracking-wider">Note (opzionali)</span>
        <input
          type="text" value={note} onChange={e => setNote(e.target.value)}
          className="input-base mt-1" placeholder="Allergie, richieste..."
        />
      </label>

      <MenuSelector
        items={menu}
        quantities={qty}
        onChange={setQty}
        stickyTop={110}
        footer={
          <div className="rounded-card border border-border bg-surface p-3 shadow-md">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[12.5px] font-semibold text-textSoft tabular-nums">
                {totPezzi} {totPezzi === 1 ? 'pezzo' : 'pezzi'}
              </span>
              <span className="text-[24px] font-extrabold tabular-nums text-gold leading-none">
                € {totale.toFixed(2)}
              </span>
            </div>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="w-full min-h-btn rounded-btn font-extrabold text-lg
                         bg-gradient-to-br from-gold to-goldDeep text-bg
                         active:scale-95 transition-transform shadow-cta
                         disabled:opacity-40 disabled:active:scale-100"
            >
              Pagamento →
            </button>
            {!canSubmit && (
              <p className="text-[11px] text-textMute mt-2 text-center font-semibold">
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
    const ok = window.confirm(
      `Creare ordine bancomat da € ${totale.toFixed(2)}?\n\n` +
      `Confermerai il pagamento dopo l'incasso al POS.`
    )
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
      <div>
        <div className="text-[11px] font-extrabold tracking-[1.4px] uppercase text-textSoft mb-1">
          Step 3 · Pagamento
        </div>
        <h2 className="font-display text-[24px] leading-tight text-text">
          Riepilogo ordine
        </h2>
      </div>

      <div className="bg-surface border border-borderSoft rounded-card p-4 shadow-sm">
        <p className="text-[13px] text-textSoft font-semibold">
          Tav. <strong className="text-text tabular-nums">{draft.tavolo}</strong> · {draft.persone} pers. ·{' '}
          <strong className="text-text">{draft.nomeCliente}</strong>
        </p>
        {draft.note && (
          <p className="text-[13px] mt-2 bg-warningSoft border border-warning/40 text-warning rounded-badge p-2">
            Note: {draft.note}
          </p>
        )}
        <ul className="mt-3 divide-y divide-borderSoft">
          {itemsArr.map((it, idx) => (
            <li key={`${it.menuItem.id}-${it.mandata}-${idx}`} className="py-1.5 flex items-center gap-2 text-[14px]">
              <span className="px-1.5 py-0.5 rounded-badge bg-wineSoft border border-wine/40 text-text text-[10.5px] font-extrabold">
                M{it.mandata}
              </span>
              <span className="flex-1 text-text">{it.menuItem.nome}</span>
              <span className="text-textSoft tabular-nums">× {it.quantita}</span>
              <span className="font-extrabold tabular-nums w-16 text-right">
                € {(Number(it.menuItem.prezzo) * it.quantita).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        <div className="pt-3 mt-2 border-t border-borderSoft flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-wider font-bold text-textSoft">Totale</span>
          <span className="text-[36px] font-extrabold tabular-nums text-gold leading-none">
            € {totale.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="text-[11px] font-extrabold tracking-[1.4px] uppercase text-textSoft pt-2">
        Metodo di pagamento
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          disabled={busy}
          onClick={handleBancomat}
          className="bg-surface border-2 border-info/60 rounded-card-lg p-4
                     min-h-[110px] flex flex-col items-start justify-center gap-2
                     active:scale-95 transition-transform shadow-sm
                     disabled:opacity-50 disabled:active:scale-100"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-btn bg-gradient-to-br from-info to-info/60
                            flex items-center justify-center text-bg">
              <CreditCard size={24} strokeWidth={2.5} />
            </div>
            <span className="text-[22px] font-extrabold text-text">BANCOMAT</span>
          </div>
          <span className="text-[12.5px] text-textSoft font-semibold">
            Conferma diretta · niente passaggio in cassa
          </span>
        </button>
        <button
          disabled={busy}
          onClick={handleContanti}
          className="bg-surface border-2 border-success/60 rounded-card-lg p-4
                     min-h-[110px] flex flex-col items-start justify-center gap-2
                     active:scale-95 transition-transform shadow-sm
                     disabled:opacity-50 disabled:active:scale-100"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-btn bg-gradient-to-br from-success to-successInk
                            flex items-center justify-center text-bg">
              <Banknote size={24} strokeWidth={2.5} />
            </div>
            <span className="text-[22px] font-extrabold text-text">CONTANTI</span>
          </div>
          <span className="text-[12.5px] text-textSoft font-semibold">
            Cliente paga in cassa · ordine in coda
          </span>
        </button>
      </div>

      <button onClick={onBack} disabled={busy}
              className="w-full min-h-btn rounded-btn border border-border text-textSoft
                         font-semibold active:scale-95 transition-transform">
        ← Cambia ordine
      </button>
    </div>
  )
}

// -------------------- DETTAGLIO ORDINE --------------------

function DettaglioOrdine({ orderId, menu, onAddItems, onMandataConsegnata, onSbloccaMandata, onInviaM4, onStorna, onConfermaBancomat, chiamataAutoAttiva, autoSbloccoPerMandata }) {
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
        <p className="mb-3 font-semibold text-textSoft text-[14px]">
          Aggiungi al tavolo{' '}
          <strong className="text-text tabular-nums">{order.numero_tavolo}</strong>
          {order.nome_cliente ? <> · <strong className="text-text">{order.nome_cliente}</strong></> : null}
        </p>
        <MenuSelector
          items={menu}
          quantities={qty}
          onChange={setQty}
          stickyTop={155}
          footer={
            <div className="rounded-card border border-border bg-surface p-3 shadow-md">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[12.5px] font-semibold text-textSoft tabular-nums">
                  {totPezziAgg} pezzi
                </span>
                <span className="text-[22px] font-extrabold tabular-nums text-gold leading-none">
                  + € {totaleAgg.toFixed(2)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setAdding(false); setQty({}) }}
                  className="flex-1 min-h-btn rounded-btn border border-border bg-surface
                             text-textSoft font-semibold active:scale-95 transition-transform"
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
                  className="flex-1 min-h-btn rounded-btn font-extrabold text-text
                             bg-gradient-to-br from-gold to-goldDeep shadow-cta
                             active:scale-95 transition-transform
                             disabled:opacity-40 disabled:active:scale-100"
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

  const stornato         = order.stato === 'stornato'
  const inCassa          = order.stato === 'attesa_cassa'
  const inAttesaBancomat = order.stato === 'attesa_bancomat'
  const azioniBloccate   = stornato || inCassa || inAttesaBancomat
  const cucinaItems = items.filter(i => i.categoria === 'cucina')
  const barItems    = items.filter(i => i.categoria === 'bar')
  const cucinaGroups = groupByMandata(cucinaItems)
  const barGroups    = groupByMandata(barItems)
  const cucinaNumeri = getNumeriMandata(cucinaItems)
  const barNumeri    = getNumeriMandata(barItems)

  // "Sblocca M4" disponibile se l'ordine ha items M4 ancora in_attesa
  // o in pre_riscaldo (cioe' non ancora sbloccati) e non e' stornato/in cassa.
  const m4Items = items.filter(i => i.mandata === 4)
  const m4DaInviare = m4Items.length > 0 && m4Items.some(i =>
    i.mandata_stato === 'in_attesa' || i.mandata_stato === 'pre_riscaldo'
  )
  const puoInviareM4 = !azioniBloccate && m4DaInviare

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
          <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg"
                      variant={stornato ? 'danger' : 'gold'} />
          {order.nome_cliente && (
            <span className="text-[20px] font-extrabold text-text">· {order.nome_cliente}</span>
          )}
        </div>
        <span className="text-[28px] font-extrabold tabular-nums text-gold leading-none">
          € {Number(order.totale).toFixed(2)}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {order.tipo_pagamento === 'bancomat' && (
          <span className="pill bg-infoSoft text-info border border-info/40">
            <CreditCard size={12} /> Bancomat
          </span>
        )}
        {order.tipo_pagamento === 'contanti' && (
          <span className="pill bg-successSoft text-success border border-success/40">
            <Banknote size={12} /> Contanti
          </span>
        )}
        {inCassa && (
          <span className="pill bg-goldSoft text-gold border border-gold/40">
            ⏳ In attesa cassa
          </span>
        )}
        {inAttesaBancomat && (
          <span className="pill bg-infoSoft text-info border border-info/40 animate-blink">
            💳 In attesa pagamento bancomat
          </span>
        )}
        {stornato && (
          <span className="pill bg-dangerSoft text-danger border border-danger/40 animate-blink">
            ⚠️ Stornato
          </span>
        )}
      </div>

      {stornato && (
        <div className="bg-dangerSoft border border-danger/60 rounded-card p-3">
          <p className="font-extrabold text-danger mb-1 uppercase tracking-wider text-[12px]">
            Ordine in pausa
          </p>
          {order.storno_note && (
            <p className="text-[13px] break-words text-text">Motivo: {order.storno_note}</p>
          )}
          <p className="text-[11px] text-textSoft mt-1 font-semibold">
            La cassa lo ri-confermerà dopo l'incasso.
          </p>
        </div>
      )}

      {inAttesaBancomat && (
        <div className="bg-infoSoft border border-info/60 rounded-card p-3">
          <p className="font-extrabold text-info mb-1 uppercase tracking-wider text-[12px]">
            💳 Pagamento al POS in corso
          </p>
          <p className="text-[13px] text-text">
            Fai pagare con bancomat (POS o cellulare). Quando vedi la transazione
            confermata, premi <strong>"Pagamento effettuato"</strong> qui sotto:
            cucina e bar partono solo dopo questo click.
          </p>
        </div>
      )}

      {inAttesaBancomat && (
        <button
          disabled={busy}
          onClick={async () => {
            const ok = window.confirm(
              `Conferma pagamento bancomat di € ${Number(order.totale).toFixed(2)}?\n\n` +
              `Cucina e bar partiranno subito con M1.`
            )
            if (!ok) return
            try {
              setBusy(true)
              await onConfermaBancomat()
            } catch (e) {
              alert('Errore: ' + (e.message || e))
            } finally {
              setBusy(false)
            }
          }}
          className="w-full min-h-btn rounded-btn font-extrabold text-lg py-3
                     bg-gradient-to-br from-info to-info/70 text-bg shadow-cta
                     active:scale-95 transition-transform
                     disabled:opacity-50 disabled:active:scale-100
                     inline-flex items-center justify-center gap-2"
        >
          <CreditCard size={22} strokeWidth={3} />
          {busy ? 'Conferma in corso…' : 'Pagamento effettuato'}
        </button>
      )}

      {order.note && (
        <p className="text-[13px] bg-warningSoft border border-warning/40 text-warning rounded-card p-2.5">
          Note: {order.note}
        </p>
      )}

      {/* Cucina */}
      <SezioneMandate
        titolo="🍳 Cucina"
        colore="text-wine"
        numeri={cucinaNumeri}
        groups={cucinaGroups}
        categoria="cucina"
        disabled={azioniBloccate}
        onConsegnata={(n) => onMandataConsegnata(n, 'cucina')}
        onSblocca={onSbloccaMandata}
        chiamataAutoAttiva={chiamataAutoAttiva}
        autoSbloccoPerMandata={autoSbloccoPerMandata}
      />

      {/* Bar */}
      <SezioneMandate
        titolo="🍺 Bar"
        colore="text-bar"
        numeri={barNumeri}
        groups={barGroups}
        categoria="bar"
        disabled={azioniBloccate}
        onConsegnata={(n) => onMandataConsegnata(n, 'bar')}
        onSblocca={onSbloccaMandata}
        chiamataAutoAttiva={chiamataAutoAttiva}
        autoSbloccoPerMandata={autoSbloccoPerMandata}
      />

      {puoInviareM4 && (
        <button
          disabled={busy}
          onClick={async () => {
            if (!window.confirm('Sbloccare M4?\nDolci, caffè e amari diventano URGENTI in cucina/bar.')) return
            try {
              setBusy(true)
              await onInviaM4()
            } catch (e) {
              alert('Errore: ' + (e.message || e))
            } finally {
              setBusy(false)
            }
          }}
          className="w-full min-h-btn rounded-btn font-extrabold py-3 text-bg
                     bg-gradient-to-br from-gold to-goldDeep shadow-cta
                     active:scale-95 transition-transform"
        >
          ☕ Sblocca M4 — Dolci · Caffè · Amari ({m4Items.reduce((s, i) => s + i.quantita, 0)} pezzi)
        </button>
      )}

      {!azioniBloccate && (
        <button
          onClick={() => setAdding(true)}
          disabled={busy}
          className="w-full min-h-btn rounded-btn border border-info/50 bg-infoSoft text-info
                     font-extrabold active:scale-95 transition-transform">
          + Aggiungi all'ordine
        </button>
      )}

      {!stornato && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {order.tipo_pagamento === 'bancomat' && (
            <button
              disabled={busy}
              onClick={azionePassaAContanti}
              className="px-3 py-3 rounded-btn font-extrabold border border-border bg-surface text-textSoft
                         active:scale-95 transition-transform"
            >
              💳 → 💵 Bancomat in Contanti
            </button>
          )}
          <button
            disabled={busy}
            onClick={azioneStorna}
            className={`px-3 py-3 rounded-btn font-extrabold border border-danger/60 bg-dangerSoft text-danger
                        active:scale-95 transition-transform
                        ${order.tipo_pagamento === 'bancomat' ? '' : 'sm:col-span-2'}`}
          >
            ⚠️ Storna ordine
          </button>
        </div>
      )}
    </div>
  )
}

// Priorita' display delle sezioni mandata nel dettaglio (basso = piu' in alto).
//   1. in_finestra      🪟 da portare subito
//   2. sbloccata        🔴 urgente / da confermare
//   3. in_preparazione  🔄
//   4. pre_riscaldo     🟡 (bloccate, in attesa)
//   5. in_attesa / in_pausa
//   6. consegnata       ✅ in fondo
const SEZIONE_PRIORITA = {
  in_finestra:     1,
  sbloccata:       2,
  in_preparazione: 3,
  pre_riscaldo:    4,
  in_attesa:       5,
  in_pausa:        5,
  consegnata:      6,
}

function SezioneMandate({ titolo, colore, numeri, groups, categoria, disabled, onConsegnata, onSblocca, chiamataAutoAttiva, autoSbloccoPerMandata }) {
  if (numeri.length === 0) return null

  // Calcola eligibilita' sblocco PRIMA del riordino (la sequenzialita'
  // dello sblocco dipende dal numero, non dalla priorita' display).
  const sbloccoMap = {}
  numeri.forEach((n, idx) => {
    const prevN = numeri[idx - 1]
    const prevDone = idx === 0 || (
      prevN != null && (groups[prevN] || []).every(i =>
        i.mandata_stato === 'in_finestra' || i.mandata_stato === 'consegnata'
      )
    )
    const haDaSbloccare = (groups[n] || []).some(i =>
      i.mandata_stato === 'in_attesa' || i.mandata_stato === 'pre_riscaldo'
    )
    // M4 bar (caffe'/amari): sblocco SEMPRE manuale. Per altre mandate
    // bar non mostriamo lo sblocco (parte automaticamente con l'ordine).
    sbloccoMap[n] = !disabled && haDaSbloccare && prevDone &&
      (categoria === 'cucina' || (categoria === 'bar' && n === 4))
  })

  // Ordina per priorita' display: cose pronte/urgenti in alto, consegnate in fondo.
  const numeriSorted = [...numeri].sort((a, b) => {
    const pa = SEZIONE_PRIORITA[getStatoMandataDisplay(groups[a])] ?? 5
    const pb = SEZIONE_PRIORITA[getStatoMandataDisplay(groups[b])] ?? 5
    if (pa !== pb) return pa - pb
    return a - b
  })

  return (
    <div>
      <h3 className={`font-extrabold mb-2 text-[13px] uppercase tracking-[1.4px] ${colore}`}>
        {titolo}
      </h3>
      <ul className="flex flex-col gap-2.5">
        {numeriSorted.map(n => (
          <MandataRow
            key={n}
            numero={n}
            items={groups[n]}
            categoria={categoria}
            disabled={disabled}
            onConsegnata={() => onConsegnata(n)}
            onSblocca={sbloccoMap[n] ? () => onSblocca && onSblocca(n) : null}
            chiamataAutoAttiva={chiamataAutoAttiva}
            autoSbloccoScadenza={autoSbloccoPerMandata?.[n] ?? null}
          />
        ))}
      </ul>
    </div>
  )
}

const MANDATA_ROW_META = {
  in_attesa:       { borderCls: 'border-borderSoft', textCls: 'text-textSoft',  icon: '⬜', label: 'IN ATTESA' },
  pre_riscaldo:    { borderCls: 'border-warning',    textCls: 'text-warning',   icon: '🟡', label: 'PRE-RISCALDO' },
  sbloccata:       { borderCls: 'border-danger',     textCls: 'text-danger',    icon: '🔴', label: 'URGENTE' },
  in_preparazione: { borderCls: 'border-warning',    textCls: 'text-warning',   icon: '🔄', label: 'IN PREPARAZIONE' },
  in_finestra:     { borderCls: 'border-success',    textCls: 'text-success',   icon: '🪟', label: 'IN FINESTRA' },
  consegnata:      { borderCls: 'border-borderSoft', textCls: 'text-textMute',  icon: '✅', label: 'CONSEGNATA' },
  in_pausa:        { borderCls: 'border-danger',     textCls: 'text-danger',    icon: '⏸',  label: 'IN PAUSA' },
}

function MandataRow({ numero, items, categoria, disabled, onConsegnata, onSblocca, chiamataAutoAttiva, autoSbloccoScadenza }) {
  const stato = getStatoMandataDisplay(items)
  const [busy, setBusy] = useState(false)
  const meta = MANDATA_ROW_META[stato] || MANDATA_ROW_META.in_attesa

  const isUrgente = stato === 'sbloccata'
  const isCollapsed = stato === 'consegnata'
  const sourceIcon = categoria === 'cucina' ? '🍳' : '🍺'

  // Chiamata automatica: se attiva e c'e' una scadenza futura per questa
  // mandata, il pulsante diventa "Forza uscita MN (auto tra MM:SS)" e
  // chiede conferma prima dello sblocco anticipato.
  const inAutoCountdown = chiamataAutoAttiva && autoSbloccoScadenza != null && autoSbloccoScadenza > Date.now()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!inAutoCountdown) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [inAutoCountdown])
  const secondsLeftAuto = inAutoCountdown
    ? Math.max(0, Math.floor((autoSbloccoScadenza - now) / 1000))
    : 0

  return (
    <li className={`relative rounded-card p-3 border-[1.5px] ${meta.borderCls} bg-surface shadow-sm
                    ${isCollapsed ? 'opacity-60' : ''}
                    ${isUrgente ? 'animate-pulseUrgent' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-[9px]
                           bg-surfaceElev border border-border text-base">
            {sourceIcon}
          </span>
          <div>
            <div className="text-[14px] font-extrabold tracking-[0.4px] text-text">
              MANDATA {numero}
            </div>
            <div className={`text-[11px] font-bold uppercase tracking-[0.4px] mt-[1px] ${meta.textCls}`}>
              {meta.icon} {meta.label}
            </div>
          </div>
        </div>
      </div>

      {/* Items (nascosti se consegnata: solo sommario) */}
      {!isCollapsed ? (
        <ul className="flex flex-col gap-1.5">
          {items.map(it => (
            <li key={it.id}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px]
                           bg-[rgba(196,168,130,0.06)] border border-borderSoft">
              <span className="min-w-[36px] h-[28px] px-2 rounded-badge inline-flex items-center justify-center
                               bg-surfaceElev text-text font-extrabold text-[14px] tabular-nums border border-border">
                {it.quantita}×
              </span>
              <span className="flex-1 text-[14px] font-semibold break-words text-text">
                {it.nome_item}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-textMute font-semibold">
          {items.map(i => `${i.nome_item} ×${i.quantita}`).join(' · ')}
        </p>
      )}

      {/* CTA: Sblocca (se applicabile). Dal dettaglio il cameriere puo'
          sempre forzare anche con chiamata automatica attiva — chiede conferma. */}
      {!disabled && onSblocca && (
        <button
          disabled={busy}
          onClick={async () => {
            if (inAutoCountdown) {
              const ok = window.confirm(
                `Vuoi anticipare l'uscita di M${numero}?\n` +
                `Il timer automatico (${formatCountdownSec(secondsLeftAuto)}) verrà annullato.`
              )
              if (!ok) return
            }
            setBusy(true)
            try { await onSblocca() } finally { setBusy(false) }
          }}
          className={`w-full mt-2.5 min-h-[48px] rounded-btn font-extrabold text-[14px] tracking-[0.3px]
                      inline-flex items-center justify-center gap-2 active:scale-95 transition-transform
                      ${inAutoCountdown
                        ? 'bg-surfaceElev text-text border border-gold/60'
                        : 'bg-gradient-to-br from-gold to-goldDeep text-bg shadow-cta'}`}
        >
          {inAutoCountdown
            ? `⚡ Forza uscita M${numero} (auto tra ${formatCountdownSec(secondsLeftAuto)})`
            : (numero === 4 ? '☕ Sblocca M4 →' : `🍽️ Esci con M${numero} →`)}
        </button>
      )}

      {/* CTA: Consegnata (solo se in_finestra) */}
      {stato === 'in_finestra' && !disabled && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try { await onConsegnata() } finally { setBusy(false) }
          }}
          className="w-full mt-2.5 min-h-[44px] rounded-btn font-extrabold text-[14px]
                     bg-success text-bg active:scale-95 transition-transform shadow-[0_3px_0_#3F2A1F]"
        >
          ✅ Ho portato M{numero} al tavolo
        </button>
      )}
    </li>
  )
}

// -------------------- RIORDINO RAPIDO --------------------
//
// Schermata dedicata per aggiungere voci a un tavolo gia' seduto/pagato.
// Mostra TUTTI gli items (cucina+bar) in una lista unica raggruppata per
// portata, con barra di ricerca. Tutto viene messo automaticamente in M1.
// Footer fisso con totale + "Avanti → Pagamento".

const PORTATE_RIORDINO_CUCINA = [
  { label: 'Antipasti', test: o => o >= 1  && o <= 9  },
  { label: 'Primi',     test: o => o >= 10 && o <= 19 },
  { label: 'Secondi',   test: o => o >= 20 && o <= 29 },
  { label: 'Contorni',  test: o => o >= 40 && o <= 49 },
  { label: 'Dolci',     test: o => o >= 30 && o <= 39 },
]
const PORTATE_RIORDINO_BAR = [
  { label: 'Acqua',                   test: o => o >= 1  && o <= 9  },
  { label: 'Vino sfuso',              test: o => o >= 10 && o <= 19 },
  { label: 'Verdicchio',              test: o => o >= 20 && o <= 29 },
  { label: "Lacrima di Morro d'Alba", test: o => o >= 30 && o <= 39 },
  { label: 'Caffè',                   test: o => o >= 40 && o <= 49 },
  { label: 'Amari',                   test: o => o >= 50 && o <= 59 },
]

function raggruppaPerPortata(items, schema) {
  const groups = schema.map(p => ({
    label: p.label,
    items: items.filter(i => p.test(i.ordine ?? 0))
                .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)),
  }))
  const altro = items.filter(i => !schema.some(p => p.test(i.ordine ?? 0)))
  if (altro.length) groups.push({ label: 'Altro', items: altro })
  return groups.filter(g => g.items.length > 0)
}

function RiordinoRapido({ menu, draft, onProceedToPayment, onRefresh, refreshing }) {
  const [qty, setQty] = useState(draft?.qty || {})
  const [cerca, setCerca] = useState('')

  const itemsAttivi = useMemo(
    () => (menu || []).filter(i => i.attivo !== false),
    [menu]
  )

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    if (!q) return itemsAttivi
    return itemsAttivi.filter(i => (i.nome || '').toLowerCase().includes(q))
  }, [itemsAttivi, cerca])

  const cucinaGroups = useMemo(
    () => raggruppaPerPortata(filtrati.filter(i => i.categoria === 'cucina'), PORTATE_RIORDINO_CUCINA),
    [filtrati]
  )
  const barGroups = useMemo(
    () => raggruppaPerPortata(filtrati.filter(i => i.categoria === 'bar'), PORTATE_RIORDINO_BAR),
    [filtrati]
  )

  const totaleItems = useMemo(
    () => Object.values(qty).reduce((s, m) => s + (Number(m?.[1]) || 0), 0),
    [qty]
  )
  const totalePrezzo = useMemo(() => {
    let tot = 0
    for (const [id, m] of Object.entries(qty)) {
      const q1 = Number(m?.[1]) || 0
      if (q1 === 0) continue
      const item = menu.find(x => String(x.id) === String(id))
      if (item) tot += Number(item.prezzo) * q1
    }
    return tot
  }, [qty, menu])

  const setItemQty = (item, delta) => {
    const cur = Number(qty[item.id]?.[1]) || 0
    const next = Math.max(0, cur + delta)
    const updated = { ...qty }
    if (next === 0) delete updated[item.id]
    else updated[item.id] = { 1: next }
    setQty(updated)
  }

  const renderRiga = (item) => {
    const q = Number(qty[item.id]?.[1]) || 0
    return (
      <li key={item.id} className="card flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold break-words whitespace-normal">{item.nome}</p>
          <p className="text-sm opacity-80">€ {Number(item.prezzo).toFixed(2)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setItemQty(item, -1)}
            disabled={q === 0}
            className="w-11 h-11 rounded-xl bg-red-700 font-bold text-xl
                       active:scale-95 transition-transform disabled:opacity-30"
          >
            −
          </button>
          <span className="w-8 text-center text-lg font-bold">{q}</span>
          <button
            type="button"
            onClick={() => setItemQty(item, +1)}
            className="w-11 h-11 rounded-xl bg-green-700 font-bold text-xl
                       active:scale-95 transition-transform"
          >
            +
          </button>
        </div>
      </li>
    )
  }

  return (
    <div className="pb-28">
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold truncate">
            Aggiungi all'ordine — Tav. {draft?.tavolo}
          </h2>
          <p className="text-sm opacity-80 truncate">{draft?.nomeCliente}</p>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Ricarica menu"
            title="Ricarica menu"
            className={`w-9 h-9 rounded-lg bg-pannello border border-bordo text-base
                        flex items-center justify-center active:scale-95
                        disabled:opacity-50 ${refreshing ? 'animate-spin' : ''}`}
          >
            🔄
          </button>
        )}
      </div>

      <input
        type="search"
        inputMode="search"
        value={cerca}
        onChange={e => setCerca(e.target.value)}
        placeholder="Cerca per nome (es. acqua, caffè)…"
        className="input-base mb-4"
      />

      {filtrati.length === 0 && (
        <p className="text-center opacity-60 py-6">
          Nessuna voce corrisponde a "{cerca}"
        </p>
      )}

      {cucinaGroups.length > 0 && (
        <div className="mb-4">
          <h3 className="text-cucina font-bold text-sm uppercase tracking-widest mb-2
                         border-b border-cucina/40 pb-1">
            🍳 Cucina
          </h3>
          <ul className="space-y-2">
            {cucinaGroups.flatMap(g => [
              <li key={`cuc-hdr-${g.label}`}
                  className="bg-black/30 border-y border-bordo py-1 text-center
                             text-xs font-bold uppercase tracking-widest opacity-80">
                — {g.label} —
              </li>,
              ...g.items.map(renderRiga),
            ])}
          </ul>
        </div>
      )}

      {barGroups.length > 0 && (
        <div className="mb-4">
          <h3 className="text-bar font-bold text-sm uppercase tracking-widest mb-2
                         border-b border-bar/40 pb-1">
            🍺 Bar
          </h3>
          <ul className="space-y-2">
            {barGroups.flatMap(g => [
              <li key={`bar-hdr-${g.label}`}
                  className="bg-black/30 border-y border-bordo py-1 text-center
                             text-xs font-bold uppercase tracking-widest opacity-80">
                — {g.label} —
              </li>,
              ...g.items.map(renderRiga),
            ])}
          </ul>
        </div>
      )}

      {/* Footer fisso con totale + Avanti */}
      <div className="fixed bottom-0 left-0 right-0 bg-bg border-t border-border
                      px-4 py-3 z-30 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12.5px] font-semibold text-textSoft tabular-nums">
            {totaleItems} {totaleItems === 1 ? 'pezzo' : 'pezzi'}
          </span>
          <span className="text-[24px] font-extrabold tabular-nums text-gold leading-none">
            € {totalePrezzo.toFixed(2)}
          </span>
        </div>
        <button
          type="button"
          disabled={totaleItems === 0}
          onClick={() => onProceedToPayment(qty)}
          className="w-full min-h-btn rounded-btn font-extrabold text-lg
                     bg-gradient-to-br from-gold to-goldDeep text-bg
                     active:scale-95 transition-transform shadow-cta
                     disabled:opacity-40 disabled:active:scale-100"
        >
          Pagamento →
        </button>
      </div>
    </div>
  )
}
