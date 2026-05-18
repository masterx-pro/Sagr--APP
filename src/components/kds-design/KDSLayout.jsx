import { useState, useCallback, useRef } from 'react'
import { LogOut, Columns3, LayoutGrid, ChefHat, Beer, Moon, Sun } from 'lucide-react'
import KDSColumn from './KDSColumn.jsx'
import KDSAggregato from './KDSAggregato.jsx'

/**
 * KDSLayout — layout principale del Kitchen Display System.
 *
 * Due modalità:
 *
 *   UNCONTROLLED (demo): passa initialOrders. Lo stato (incluso advance e
 *   toggleRush) e' gestito internamente.
 *
 *   CONTROLLED (DB reale): passa orders + onAdvance + onRush. Il chiamante
 *   gestisce le mutazioni (es. Supabase) e ri-passa la lista aggiornata via
 *   prop. L'animazione "fly" resta locale: trigger immediato all'uscita,
 *   trigger al rientro quando l'ordine ricompare nella colonna successiva
 *   (o quando viene rimosso e poi ricreato dalla pipeline di refetch).
 *
 * Props comuni:
 *   role: 'cucina' | 'bar'
 *   servizio: 'pranzo' | 'cena'
 *   subtitle?: string                 — testo accessorio (es. "Marco · 8 attivi")
 *   topBar?: ReactNode                — slot per badge extra nel header
 *   onLogout?()
 *
 * Le 3 colonne mappano gli stati così:
 *   DA FARE      = sbloccata + pre_riscaldo
 *   IN CORSO     = in_preparazione
 *   IN FINESTRA  = in_finestra
 */
export default function KDSLayout({
  role = 'cucina',
  servizio = 'cena',
  subtitle,
  topBar,
  onLogout,
  // Modalità controllata (DB reale)
  orders: ordersControlled,
  onAdvance,
  onRush,
  // Modalità uncontrolled (demo)
  initialOrders,
}) {
  const isControlled = ordersControlled !== undefined

  const [ordersInternal, setOrdersInternal] = useState(() => initialOrders ?? [])
  const orders = isControlled ? ordersControlled : ordersInternal

  const [view, setView] = useState('colonne')   // 'colonne' | 'aggregato'

  // ── transizioni card → colonna successiva ──
  const [flyingOut, setFlyingOut]   = useState(new Set())
  const [flyingIn, setFlyingIn]     = useState(new Set())
  const [flashCol, setFlashCol]     = useState(null)
  const timeoutsRef = useRef([])

  const advance = useCallback((order) => {
    const nextStato = NEXT_STATE[order.stato]
    if (!nextStato) return

    // 1) fly-out immediato
    setFlyingOut(prev => new Set(prev).add(order.id))

    // 2) dopo 280ms: aggiorna lo stato e prepara il fly-in
    const t1 = setTimeout(() => {
      if (isControlled) {
        // Delega al parent. La nuova lista arriverà via prop (realtime/refetch).
        try { onAdvance?.(order) } catch (e) { console.warn('onAdvance throw:', e) }
      } else {
        setOrdersInternal(curr => curr.map(o =>
          o.id === order.id ? { ...o, stato: nextStato } : o
        ))
      }
      setFlyingOut(prev => { const n = new Set(prev); n.delete(order.id); return n })
      setFlyingIn(prev => new Set(prev).add(order.id))
      setFlashCol(STATE_TO_COL[nextStato])

      const t2 = setTimeout(() => {
        setFlyingIn(prev => { const n = new Set(prev); n.delete(order.id); return n })
        setFlashCol(null)
      }, 320)
      timeoutsRef.current.push(t2)
    }, 280)
    timeoutsRef.current.push(t1)
  }, [isControlled, onAdvance])

  const toggleRush = useCallback((order) => {
    if (isControlled) {
      try { onRush?.(order) } catch (e) { console.warn('onRush throw:', e) }
      return
    }
    setOrdersInternal(curr => curr.map(o =>
      o.id === order.id ? { ...o, rush: !o.rush } : o
    ))
  }, [isControlled, onRush])

  // Filtra per colonna
  const daFare    = orders.filter(o => o.stato === 'sbloccata' || o.stato === 'pre_riscaldo')
  const inCorso   = orders.filter(o => o.stato === 'in_preparazione')
  const inFinestra = orders.filter(o => o.stato === 'in_finestra')

  const flyingIds = new Set([...flyingOut, ...flyingIn])
  const flyingDirection = flyingOut.size > 0 ? 'out' : (flyingIn.size > 0 ? 'in' : null)

  const roleMeta = ROLE_META[role]

  return (
    <div className="h-screen w-screen flex flex-col bg-bg text-text font-ui overflow-hidden">
      {/* HEADER pagina */}
      <header
        className="shrink-0 flex items-center gap-3 px-4 h-[70px] border-b border-borderSoft"
        style={{
          background: `linear-gradient(135deg, ${roleMeta.from} 0%, ${roleMeta.to} 100%)`,
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-card bg-bg/30 border border-white/10
                          flex items-center justify-center text-gold">
            <roleMeta.icon size={26} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] leading-none text-text">
              {roleMeta.title}
            </h1>
            <p className="text-[12px] font-bold text-textSoft uppercase tracking-[1.2px] mt-1 truncate">
              {subtitle ?? `Live · ${orders.length} ordin${orders.length === 1 ? 'e' : 'i'} attiv${orders.length === 1 ? 'o' : 'i'}`}
            </p>
          </div>
        </div>

        {/* Tab Per colonna / Aggregato */}
        <div className="ml-auto flex items-center gap-2">
          {topBar}
          <div className="flex p-1 rounded-card bg-bg/40 border border-white/10">
            <TabBtn
              active={view === 'colonne'}
              onClick={() => setView('colonne')}
              icon={Columns3}
              label="Colonne"
            />
            <TabBtn
              active={view === 'aggregato'}
              onClick={() => setView('aggregato')}
              icon={LayoutGrid}
              label="Aggregato"
            />
          </div>

          <span className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-full
                           bg-bg/40 border border-white/10
                           text-gold font-extrabold text-[12px] uppercase tracking-[1.4px]">
            {servizio === 'cena' ? <Moon size={14} /> : <Sun size={14} />}
            {servizio}
          </span>

          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-btn
                       border border-white/20 bg-bg/30 text-text
                       font-bold text-[13px] uppercase tracking-[1px]
                       active:scale-95 transition-transform"
          >
            <LogOut size={16} strokeWidth={2.4} />
            Esci
          </button>
        </div>
      </header>

      {/* MAIN — 3 colonne o aggregato */}
      <main className="flex-1 min-h-0 p-3">
        {view === 'colonne' ? (
          <div className="h-full grid grid-cols-3 gap-3">
            <KDSColumn
              id="da-fare"
              title="Da fare"
              icon="🔴"
              tone="danger"
              orders={daFare}
              flashing={flashCol === 'da-fare'}
              flyingIds={flyingIds}
              flyingDirection={flyingDirection}
              onAdvance={advance}
              onRush={toggleRush}
            />
            <KDSColumn
              id="in-corso"
              title="In corso"
              icon="🔄"
              tone="warning"
              orders={inCorso}
              flashing={flashCol === 'in-corso'}
              flyingIds={flyingIds}
              flyingDirection={flyingDirection}
              onAdvance={advance}
              onRush={toggleRush}
            />
            <KDSColumn
              id="in-finestra"
              title="In finestra"
              icon="🪟"
              tone="success"
              orders={inFinestra}
              flashing={flashCol === 'in-finestra'}
              flyingIds={flyingIds}
              flyingDirection={flyingDirection}
              onAdvance={advance}
              onRush={toggleRush}
            />
          </div>
        ) : (
          <KDSAggregato orders={orders} role={role} onAdvance={advance} />
        )}
      </main>
    </div>
  )
}

function TabBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 px-3 h-9 rounded-btn font-extrabold text-[13px]',
        'uppercase tracking-[1px] transition-all active:scale-95',
        active
          ? 'bg-gold text-bg shadow-cta'
          : 'bg-transparent text-textSoft hover:text-text',
      ].join(' ')}
    >
      <Icon size={15} strokeWidth={2.6} />
      {label}
    </button>
  )
}

const NEXT_STATE = {
  pre_riscaldo:     'in_preparazione',
  sbloccata:        'in_preparazione',
  in_preparazione:  'in_finestra',
  in_finestra:      null,
}

const STATE_TO_COL = {
  pre_riscaldo:    'da-fare',
  sbloccata:       'da-fare',
  in_preparazione: 'in-corso',
  in_finestra:     'in-finestra',
}

const ROLE_META = {
  cucina: {
    title: 'Cucina',
    icon:  ChefHat,
    from:  '#8B2120',
    to:    '#3E0A0A',
  },
  bar: {
    title: 'Bar',
    icon:  Beer,
    from:  '#B8541F',
    to:    '#5C2410',
  },
}
