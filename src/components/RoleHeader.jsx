import ServizioBadge from './ServizioBadge.jsx'

/**
 * RoleHeader — header per ogni ruolo con gradient + servizio + slot azioni.
 *
 * Props:
 *  - role: 'cameriere' | 'cucina' | 'bar' | 'cassa' | 'admin'
 *  - title: titolo grande in DM Serif Display
 *  - subtitle?: stringa sotto al titolo
 *  - eyebrow?: stringa uppercase sopra al titolo (default "RUOLO · SAGRA")
 *  - impostazioni?: per ServizioBadge
 *  - leftAction?: nodo (es. back button)
 *  - right?: nodi azioni (es. bell, esci)
 *  - showBadge?: default true
 *  - compact?: bool (riduce padding e font)
 */

const ROLE_GRADIENT = {
  cameriere: 'from-role-cameriere-from to-role-cameriere-to',
  cucina:    'from-role-cucina-from    to-role-cucina-to',
  bar:       'from-role-bar-from       to-role-bar-to',
  cassa:     'from-role-cassa-from     to-role-cassa-to',
  admin:     'from-role-admin-from     to-role-admin-to',
}

const ROLE_NAME = {
  cameriere: 'CAMERIERE',
  cucina:    'CUCINA',
  bar:       'BAR',
  cassa:     'CASSA',
  admin:     'ADMIN',
}

export default function RoleHeader({
  role = 'cameriere',
  title,
  subtitle,
  eyebrow,
  impostazioni,
  servizio,
  leftAction,
  right,
  showBadge = true,
  compact = false,
}) {
  const eb = eyebrow || `${ROLE_NAME[role] || role.toUpperCase()} · SagràApp`
  return (
    <header
      className={`sticky top-0 z-30 bg-gradient-to-b ${ROLE_GRADIENT[role] || ROLE_GRADIENT.cameriere}
                  text-text rounded-b-sheet shadow-md
                  ${compact ? 'pt-9 pb-3 px-4' : 'pt-[54px] pb-4 px-[18px]'}`}
    >
      <div
        aria-hidden
        className="absolute inset-0 rounded-b-sheet pointer-events-none opacity-[0.16] mix-blend-overlay"
        style={{
          background:
            'repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 6px)',
        }}
      />
      <div className="relative flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {leftAction}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-extrabold tracking-[1.5px] opacity-80 uppercase">
              {eb}
            </div>
            <div className="font-display text-[28px] leading-[1.05] mt-0.5 tracking-[-0.4px] truncate">
              {title}
            </div>
            {subtitle && (
              <div className="text-[13px] opacity-80 mt-1 font-medium truncate">
                {subtitle}
              </div>
            )}
            {showBadge && (
              <div className="mt-2.5">
                <ServizioBadge impostazioni={impostazioni} servizio={servizio} />
              </div>
            )}
          </div>
        </div>
        {right && (
          <div className="flex gap-2 items-center shrink-0">
            {right}
          </div>
        )}
      </div>
    </header>
  )
}

/**
 * Bottoncino icona da usare nello slot `right` di RoleHeader.
 * Background semi-trasparente per leggersi su qualsiasi gradient.
 */
export function HeaderIconBtn({ children, onClick, badge, ariaLabel, title }) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className="relative inline-flex items-center justify-center w-10 h-10 rounded-[14px]
                 bg-white/15 text-text active:scale-95 transition-transform"
    >
      {children}
      {badge != null && badge !== 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full
                         bg-gold text-bg text-[11px] font-extrabold tabular-nums
                         inline-flex items-center justify-center leading-none
                         shadow-[0_0_0_2px_rgba(0,0,0,0.4)]">
          {badge}
        </span>
      )}
    </button>
  )
}

/**
 * Pulsante "Esci" outline coerente.
 */
export function HeaderExitBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-btn border border-white/40 text-[13px] font-semibold
                 text-text active:scale-95 transition-transform"
    >
      Esci
    </button>
  )
}
