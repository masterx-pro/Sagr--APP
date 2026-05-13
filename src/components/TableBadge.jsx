/**
 * TableBadge: pillola colorata con il numero del tavolo.
 */
export default function TableBadge({ numero, persone, size = 'md' }) {
  const sizes = {
    sm: 'text-base px-2 py-0.5',
    md: 'text-lg px-3 py-1',
    lg: 'text-2xl px-4 py-2'
  }
  return (
    <div className={`inline-flex items-center gap-2 rounded-xl
                    bg-cameriere/80 font-bold ${sizes[size]}`}>
      <span>Tav. {numero}</span>
      {typeof persone === 'number' && (
        <span className="text-xs font-normal opacity-90">
          · {persone} pers.
        </span>
      )}
    </div>
  )
}
