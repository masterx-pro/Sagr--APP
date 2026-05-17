/**
 * TableBadge — pillola colorata con il numero del tavolo (dark token).
 *  - variant: 'default' | 'gold' | 'danger' | 'wine'
 */
const VARIANTS = {
  default: 'bg-wineSoft text-text border border-wine/40',
  gold:    'bg-goldSoft text-gold border border-gold/40',
  danger:  'bg-dangerSoft text-danger border border-danger/40',
  wine:    'bg-wine text-text border border-wineDeep',
}

export default function TableBadge({ numero, persone, size = 'md', variant = 'default', className = '' }) {
  const sizes = {
    sm: 'text-sm px-2 py-0.5 rounded-badge',
    md: 'text-base px-3 py-1 rounded-btn',
    lg: 'text-2xl px-4 py-2 rounded-card',
  }
  return (
    <div className={`inline-flex items-center gap-2 font-extrabold tabular-nums
                    ${sizes[size]} ${VARIANTS[variant] || VARIANTS.default} ${className}`}>
      <span>Tav. {numero}</span>
      {typeof persone === 'number' && (
        <span className="text-xs font-semibold opacity-80">
          · {persone} pers.
        </span>
      )}
    </div>
  )
}
