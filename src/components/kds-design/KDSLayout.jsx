import { useEffect, useState, useCallback, useRef } from 'react'
import { LogOut, Columns3, LayoutGrid, ChefHat, Beer, Moon, Sun } from 'lucide-react'
import KDSColumn from './KDSColumn.jsx'
import KDSAggregato from './KDSAggregato.jsx'

/**
 * KDSLayout — layout principale del Kitchen Display System.
 *
 * Due modalità dati:
 *
 *   UNCONTROLLED (demo): passa initialOrders. Lo stato (incluso advance e
 *   toggleRush) e' gestito internamente.
 *
 *   CONTROLLED (DB reale): passa orders + onAdvance + onRush. Il chiamante
 *   gestisce le mutazioni (es. Supabase) e ri-passa la lista aggiornata via
 *   prop. L'animazione "fly" resta locale.
 *
 * Due modalità layout (auto-detected via window dimensions):
 *
 *   LANDSCAPE (width >= height): 3 colonne affiancate scrollabili.
 *   PORTRAIT  (width <  height): una colonna alla volta, scelta con
 *     un tab-strip in alto con badge count.
 *
 * Props comuni:
 *   role: 'cucina' | 'bar'
 *   servizio: 'pranzo' | 'cena'
 *   subtitle?: string
 *   topBar?: ReactNode
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

  const [view, setView] = useState('colonne')           // 'colonne' | 'aggregato'
  const [portraitCol, setPortraitCol] = useState('da-fare')

  const portrait = useIsPortrait()

  // ── transizioni card → colonna successiva ──
  const [flyingOut, setFlyingOut] = useState(new Set())
  const [flyingIn, setFlyingIn]   = useState(new Set())
  const [flashCol, setFlashCol]   = useState(null)
  const timeoutsRef = useRef([])

  const advance = useCallback((order) => {
    const nextStato = NEXT_STATE[order.stato]
    if (!nextStato) return

    setFlyingOut(prev => new Set(prev).add(order.id))

    const t1 = setTimeout(() => {
      if (isControlled) {
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

  // Buckets per colonna
  const daFare     = orders.filter(o => o.stato === 'sbloccata' || o.stato === 'pre_riscaldo')
  const inCorso    = orders.filter(o => o.stato === 'in_preparazione')
  const inFinestra = orders.filter(o => o.stato === 'in_finestra')

  const flyingIds = new Set([...flyingOut, ...flyingIn])
  const flyingDirection = flyingOut.size > 0 ? 'out' : (flyingIn.size > 0 ? 'in' : null)

  const roleMeta = ROLE_META[role]

  const COLUMNS = [
    { id: 'da-fare',     title: 'Da fare',     icon: '🔴', tone: 'danger',  orders: daFare },
    { id: 'in-corso',    title: 'In corso',    icon: '🔄', tone: 'warning', orders: inCorso },
    { id: 'in-finestra', title: 'In finestra', icon: '🪟', tone: 'success', orders: inFinestra },
  ]

  const renderColumn = (col) => (
    <KDSColumn
      key={col.id}
      id={col.id}
      title={col.title}
      icon={col.icon}
      tone={col.tone}
      orders={col.orders}
      flashing={flashCol === col.id}
      flyingIds={flyingIds}
      flyingDirection={flyingDirection}
      onAdvance={advance}
      onRush={toggleRush}
    />
  )

  return (
    <div className="h-screen w-screen flex flex-col bg-bg text-text font-ui overflow-hidden">
      {/* HEADER pagina */}
      <header
        className="shrink-0 flex items-center gap-2 px-3 sm:px-4 min-h-[64px] sm:h-[70px] py-2
                   border-b border-borderSoft flex-wrap sm:flex-nowrap"
        style={{
          background: `linear-gradient(135deg, ${roleMeta.from} 0%, ${roleMeta.to} 100%)`,
        }}
      >
        <div className="flex items-center gap-3 min-w-0 shrink">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-card bg-bg/30 border border-white/10
                          flex items-center justify-center text-gold shrink-0">
            <roleMeta.icon size={24} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-[18px] sm:text-[22px] leading-none text-text">
              {roleMeta.title}
            </h1>
            <p className="text-[11px] sm:text-[12px] font-bold text-textSoft uppercase
                          tracking-[1.2px] mt-1 truncate">
              {subtitle ?? `Live · ${orders.length} ordin${orders.length === 1 ? 'e' : 'i'} attiv${orders.length === 1 ? 'o' : 'i'}`}
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
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
            <span className="hidden sm:inline">Esci</span>
          </button>
        </div>
      </header>

      {/* Tab strip per colonne (solo portrait) */}
      {portrait && view === 'colonne' && (
        <div className="shrink-0 px-2 pt-2 pb-1 bg-bg/40 border-b border-borderSoft">
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-card bg-surface border border-borderSoft">
            {COLUMNS.map(col => (
              <ColumnTab
                key={col.id}
                tone={col.tone}
                icon={col.icon}
                title={col.title}
                count={col.orders.length}
                active={portraitCol === col.id}
                flashing={flashCol === col.id && portraitCol !== col.id}
                onClick={() => setPortraitCol(col.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* MAIN */}
      <main className="flex-1 min-h-0 p-2 sm:p-3">
        {view === 'colonne' ? (
          portrait ? (
            <div className="h-full">
              {renderColumn(COLUMNS.find(c => c.id === portraitCol) ?? COLUMNS[0])}
            </div>
          ) : (
            <div className="h-full grid grid-cols-3 gap-3">
              {COLUMNS.map(renderColumn)}
            </div>
          )
        ) : (
          <KDSAggregato orders={orders} role={role} onAdvance={advance} />
        )}
      </main>
    </div>
  )
}

/* ───────── hooks/components ausiliari ───────── */

function useIsPortrait() {
  const [portrait, setPortrait] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerHeight > window.innerWidth
  })
  useEffect(() => {
    const update = () => setPortrait(window.innerHeight > window.innerWidth)
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return portrait
}

function TabBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 px-2.5 sm:px-3 h-9 rounded-btn font-extrabold text-[12px] sm:text-[13px]',
        'uppercase tracking-[1px] transition-all active:scale-95',
        active
          ? 'bg-gold text-bg shadow-cta'
          : 'bg-transparent text-textSoft hover:text-text',
      ].join(' ')}
    >
      <Icon size={15} strokeWidth={2.6} />
      <span className="hidden xs:inline">{label}</span>
      <span className="xs:hidden">{label.slice(0, 4)}</span>
    </button>
  )
}

function ColumnTab({ tone, icon, title, count, active, flashing, onClick }) {
  const t = TAB_TONES[tone]
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center justify-center gap-1.5 min-h-[48px] px-2 rounded-btn',
        'font-extrabold text-[12px] uppercase tracking-[1.2px]',
        'transition-all active:scale-95',
        active ? `${t.activeBg} ${t.activeText}` : 'bg-transparent text-textSoft',
        flashing ? 'animate-blink' : '',
      ].join(' ')}
    >
      <span className="text-[16px] leading-none">{icon}</span>
      <span className="truncate">{title}</span>
      <span
        className={[
          'inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full',
          'font-mono font-extrabold text-[12px] tabular-nums',
          active ? t.badgeActive : t.badgeIdle,
        ].join(' ')}
      >
        {count}
      </span>
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
  cucina: { title: 'Cucina', icon: ChefHat, from: '#8B2120', to: '#3E0A0A' },
  bar:    { title: 'Bar',    icon: Beer,    from: '#B8541F', to: '#5C2410' },
}

const TAB_TONES = {
  danger:  { activeBg: 'bg-dangerSoft',  activeText: 'text-danger',  badgeActive: 'bg-danger text-bg',  badgeIdle: 'bg-surfaceElev text-textSoft' },
  warning: { activeBg: 'bg-warningSoft', activeText: 'text-warning', badgeActive: 'bg-warning text-bg', badgeIdle: 'bg-surfaceElev text-textSoft' },
  success: { activeBg: 'bg-successSoft', activeText: 'text-success', badgeActive: 'bg-success text-bg', badgeIdle: 'bg-surfaceElev text-textSoft' },
}
