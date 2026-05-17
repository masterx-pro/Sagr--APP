import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Search, CreditCard, Banknote, AlertTriangle, Check } from 'lucide-react'
import { supabase } from '../supabaseClient.js'
import { useOrders } from '../hooks/useOrders.js'
import { useExitConfirmGuard } from '../hooks/useExitConfirmGuard.js'
import { useImpostazioni } from '../context/ImpostazioniContext.jsx'
import TableBadge from '../components/TableBadge.jsx'
import RoleHeader, { HeaderExitBtn } from '../components/RoleHeader.jsx'

/**
 * CassaPage: ruolo cassa (dark redesign).
 * Vede tutti gli ordini in 'attesa_cassa' o 'stornato' (contanti da
 * incassare o ri-conferma post-storno). Filtra per tavolo / nome.
 * Marca "Incassato" -> ordine torna 'confermato' (riparte cucina/bar).
 */
export default function CassaPage({ user, onLogout }) {
  useExitConfirmGuard(onLogout)

  const { orders, fetchCassaQueue, confermaPagamentoCassa } = useOrders()
  const { impostazioni } = useImpostazioni()
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => { fetchCassaQueue() }, [fetchCassaQueue])

  useEffect(() => {
    const channel = supabase
      .channel('cassa-feed')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => fetchCassaQueue())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchCassaQueue])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(o => {
      const tav = String(o.numero_tavolo || '')
      const nome = (o.nome_cliente || '').toLowerCase()
      return tav.includes(q) || nome.includes(q)
    })
  }, [orders, search])

  const totaleQueue = useMemo(
    () => orders.reduce((s, o) => s + Number(o.totale || 0), 0),
    [orders]
  )

  useEffect(() => {
    if (view !== 'detail') return
    window.history.pushState(null, '', window.location.href)
    const onPop = () => { setView('list'); setSelectedId(null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [view])

  const leftAction = view === 'detail' && (
    <button
      onClick={() => { setView('list'); setSelectedId(null) }}
      className="inline-flex items-center justify-center w-10 h-10 rounded-[14px]
                 bg-white/15 text-text active:scale-95 transition-transform"
      aria-label="Indietro"
    >
      <ChevronLeft size={22} />
    </button>
  )

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <RoleHeader
        role="cassa"
        title={view === 'detail' ? 'Dettaglio ordine' : 'Cassa'}
        subtitle={user.nome}
        impostazioni={impostazioni}
        leftAction={leftAction}
        right={<HeaderExitBtn onClick={onLogout} />}
      />

      <main className="flex-1 p-4 mobile-landscape:p-3">
        {view === 'list' && (
          <ListaCassa
            orders={filtered}
            totaleQueue={orders.length}
            totaleEuro={totaleQueue}
            search={search}
            onSearch={setSearch}
            onSelect={(id) => { setSelectedId(id); setView('detail') }}
          />
        )}
        {view === 'detail' && selectedId && (
          <DettaglioCassa
            orderId={selectedId}
            onIncassato={async (tipoPagamento) => {
              try {
                await confermaPagamentoCassa(selectedId, tipoPagamento)
                await fetchCassaQueue()
                setView('list')
                setSelectedId(null)
              } catch (e) {
                alert('Errore: ' + (e.message || e))
              }
            }}
          />
        )}
      </main>
    </div>
  )
}

// -------------------- LISTA --------------------

function ListaCassa({ orders, totaleQueue, totaleEuro, search, onSearch, onSelect }) {
  if (totaleQueue === 0) {
    return (
      <div className="text-center py-16 mobile-landscape:py-6">
        <p className="font-display text-[28px] text-text mb-1">Nessun ordine 💚</p>
        <p className="text-textSoft text-[14px] font-semibold">Cassa libera, ottimo lavoro!</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Stat boxes */}
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="In attesa" value={totaleQueue} suffix={totaleQueue === 1 ? 'tavolo' : 'tavoli'} />
        <StatBox label="Totale" value={`€ ${totaleEuro.toFixed(2)}`} suffix="da incassare" highlight />
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMute pointer-events-none" />
        <input
          type="text"
          inputMode="search"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Cerca per numero tavolo o nome…"
          className="input-base pl-10"
        />
      </div>

      {orders.length === 0 ? (
        <p className="text-center text-textMute py-8 font-semibold">
          Nessun ordine corrisponde a "{search}"
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map(o => (
            <CassaCard key={o.id} order={o} onClick={() => onSelect(o.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function StatBox({ label, value, suffix, highlight = false }) {
  return (
    <div className={`bg-surface border rounded-card p-3 shadow-sm
                     ${highlight ? 'border-gold/50' : 'border-borderSoft'}`}>
      <div className="text-[10.5px] font-extrabold uppercase tracking-[1.2px] text-textSoft">
        {label}
      </div>
      <div className={`text-[24px] font-extrabold tabular-nums leading-none mt-1
                       ${highlight ? 'text-gold' : 'text-text'}`}>
        {value}
      </div>
      {suffix && (
        <div className="text-[11px] text-textSoft font-semibold mt-0.5">
          {suffix}
        </div>
      )}
    </div>
  )
}

function CassaCard({ order, onClick }) {
  const stornato = order.stato === 'stornato'
  const minuti = Math.max(0, Math.floor((Date.now() - new Date(order.created_at)) / 60000))
  const ora = new Date(order.created_at)
    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

  return (
    <li
      onClick={onClick}
      className={`cursor-pointer active:scale-[0.98] transition-transform
                  bg-surface border border-borderSoft border-l-4 rounded-card p-3 shadow-sm
                  flex flex-col gap-2
                  ${stornato ? 'border-l-danger' : 'border-l-gold'}`}
    >
      <div className="flex items-center gap-2.5">
        <div className={`w-11 h-11 rounded-btn flex items-center justify-center
                         text-[20px] font-extrabold tabular-nums shrink-0
                         ${stornato ? 'bg-dangerSoft text-danger' : 'bg-goldSoft text-gold'}`}>
          {order.numero_tavolo}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-bold leading-tight text-text truncate">
            {order.nome_cliente || `Tav. ${order.numero_tavolo}`}
          </div>
          <div className="flex items-center gap-2.5 mt-[3px] text-textSoft text-[12.5px] font-semibold">
            <span>👥 {order.n_persone || 1}</span>
            <span className="tabular-nums">⏱ {minuti}m</span>
            <span className="tabular-nums">{ora}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-[22px] font-extrabold tabular-nums leading-none
                           ${stornato ? 'text-danger' : 'text-gold'}`}>
            € {Number(order.totale).toFixed(2)}
          </div>
          <div className="text-[11px] text-textSoft font-semibold uppercase tracking-wider mt-1">
            {stornato ? 'da rimborsare' : 'contanti'}
          </div>
        </div>
      </div>

      {stornato && order.storno_note && (
        <p className="text-[12px] bg-dangerSoft border border-danger/40 text-danger rounded-badge p-2 break-words">
          <AlertTriangle size={11} className="inline mr-1" />
          Storno: {order.storno_note}
        </p>
      )}

      {order.cameriere_nome && (
        <div className="text-[11px] text-textMute font-semibold italic">
          👤 {order.cameriere_nome}
        </div>
      )}
    </li>
  )
}

// -------------------- DETTAGLIO --------------------

function DettaglioCassa({ orderId, onIncassato }) {
  const [order, setOrder] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single()
    setOrder(data)
  }, [orderId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel(`cassa-detail-${orderId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${orderId}` },
        () => load())
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [orderId, load])

  if (!order) return <p className="text-center text-textSoft py-10 font-semibold">Caricamento…</p>

  const stornato = order.stato === 'stornato'
  const items = order.order_items || []
  // group by mandata + categoria
  const grouped = {}
  for (const it of items) {
    const key = `${it.categoria}-M${it.mandata || 1}`
    if (!grouped[key]) grouped[key] = { categoria: it.categoria, mandata: it.mandata || 1, items: [] }
    grouped[key].items.push(it)
  }
  const sections = Object.values(grouped).sort((a, b) =>
    a.categoria.localeCompare(b.categoria) || a.mandata - b.mandata
  )

  const incassa = async (tipoPagamento) => {
    const metodoLabel = tipoPagamento === 'bancomat' ? 'BANCOMAT' : 'CONTANTI'
    const conferma = window.confirm(
      `Confermi l'incasso (${metodoLabel}) di € ${Number(order.totale).toFixed(2)} per Tav. ${order.numero_tavolo}${order.nome_cliente ? ' · ' + order.nome_cliente : ''}?`
    )
    if (!conferma) return
    setBusy(true)
    try {
      await onIncassato(tipoPagamento)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Hero card totale */}
      <div className={`bg-surface border-2 rounded-card-lg p-4 shadow-md
                       ${stornato ? 'border-danger/50' : 'border-gold/50'}`}>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <TableBadge numero={order.numero_tavolo} persone={order.n_persone} size="lg"
                      variant={stornato ? 'danger' : 'gold'} />
          {order.nome_cliente && (
            <span className="text-[18px] font-extrabold text-text">· {order.nome_cliente}</span>
          )}
        </div>
        <div className="flex items-end justify-between">
          <div className="text-[11px] text-textSoft uppercase tracking-[1.4px] font-extrabold">
            Totale ordine
          </div>
          <div className={`text-[42px] font-extrabold tabular-nums leading-none
                           ${stornato ? 'text-danger' : 'text-gold'}`}>
            € {Number(order.totale).toFixed(2)}
          </div>
        </div>
      </div>

      {stornato && (
        <div className="bg-dangerSoft border border-danger rounded-card p-3">
          <p className="font-extrabold text-danger mb-1 uppercase tracking-wider text-[12px]">
            <AlertTriangle size={14} className="inline mr-1" /> Ordine stornato
          </p>
          {order.storno_note && (
            <p className="text-[13px] text-text break-words">Motivo: {order.storno_note}</p>
          )}
          <p className="text-[11px] text-textSoft mt-1 font-semibold">
            Incassando, l'ordine torna in cucina/bar dove era in pausa.
          </p>
        </div>
      )}

      {order.note && (
        <p className="text-[13px] bg-warningSoft border border-warning/40 text-warning rounded-card p-2.5">
          Note: {order.note}
        </p>
      )}

      {/* Sezioni per mandata */}
      <div className="flex flex-col gap-3">
        {sections.map(sec => (
          <Sezione key={`${sec.categoria}-${sec.mandata}`}
                   categoria={sec.categoria} mandata={sec.mandata} items={sec.items} />
        ))}
      </div>

      {/* CTA pagamento */}
      {stornato ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <button
            disabled={busy}
            onClick={() => incassa('bancomat')}
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
              <span className="text-[19px] font-extrabold text-text">Ri-conferma Bancomat</span>
            </div>
          </button>
          <button
            disabled={busy}
            onClick={() => incassa('contanti')}
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
              <span className="text-[19px] font-extrabold text-text">Ri-conferma Contanti</span>
            </div>
          </button>
        </div>
      ) : (
        <button
          disabled={busy}
          onClick={() => incassa('contanti')}
          className="w-full min-h-[64px] rounded-card font-extrabold text-xl tabular-nums
                     bg-gradient-to-br from-success to-successInk text-bg shadow-md
                     active:scale-95 transition-transform
                     disabled:opacity-50 disabled:active:scale-100
                     inline-flex items-center justify-center gap-2"
        >
          <Check size={26} strokeWidth={3} />
          {busy ? 'In corso…' : 'Incassato contanti'}
        </button>
      )}
    </div>
  )
}

function Sezione({ categoria, mandata, items }) {
  const sourceIcon = categoria === 'cucina' ? '🍳' : '🍺'
  const totSezione = items.reduce(
    (s, i) => s + Number(i.prezzo_unitario || 0) * Number(i.quantita || 0),
    0
  )
  return (
    <div className="bg-surface border border-borderSoft rounded-card p-3 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-[9px]
                           bg-surfaceElev border border-border text-base">
            {sourceIcon}
          </span>
          <div className="text-[14px] font-extrabold tracking-[0.4px] text-text">
            {categoria === 'cucina' ? 'CUCINA' : 'BAR'} · MANDATA {mandata}
          </div>
        </div>
        <span className="text-[14px] font-extrabold tabular-nums text-textSoft">
          € {totSezione.toFixed(2)}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map(it => (
          <li key={it.id}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px]
                         bg-[rgba(196,168,130,0.06)] border border-borderSoft">
            <span className="min-w-[36px] h-[28px] px-2 rounded-badge inline-flex items-center justify-center
                             bg-surfaceElev text-text font-extrabold text-[14px] tabular-nums border border-border">
              {it.quantita}×
            </span>
            <span className="flex-1 text-[14px] font-semibold text-text break-words">
              {it.nome_item}
            </span>
            <span className="text-[14px] font-extrabold tabular-nums text-text shrink-0">
              € {(Number(it.prezzo_unitario) * it.quantita).toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
