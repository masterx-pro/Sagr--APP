import { useEffect, useState } from 'react'
import { X, Check } from 'lucide-react'

/**
 * NoteModal — mini panel note cottura per MenuSelector.
 *
 * Comportamento (form nuovo ordine cameriere):
 *   - swipe a destra su un piatto con q>0 → onRequest(dishId)
 *   - il chiamante apre questo modale passando `open=true`
 *   - tap su un'icona → toggle nello stato locale
 *   - tap "CONFERMA" → onConfirm(noteArray)
 *   - swipe in basso o tap X → onClose()
 *
 * Le note disponibili arrivano da props.notes (configurabili dall'admin).
 * Default: set completo richiesto dalle specifiche.
 *
 * Layout: bottom sheet animato dal basso, riempie ~55% dell'altezza.
 */
export default function NoteModal({
  open,
  dishName,
  currentQty = 1,
  initialSelected = [],
  notes = DEFAULT_NOTES,
  onClose,
  onConfirm,
}) {
  const [selected, setSelected] = useState(initialSelected)
  const [perItemQty, setPerItemQty] = useState({})  // { noteId: qty }
  const [enter, setEnter] = useState(false)

  useEffect(() => {
    if (open) {
      setSelected(initialSelected)
      setPerItemQty({})
      // attiva il transition al prossimo frame per slide-up
      requestAnimationFrame(() => setEnter(true))
    } else {
      setEnter(false)
    }
  }, [open, initialSelected])

  if (!open) return null

  const toggle = (note) => {
    setSelected(curr =>
      curr.some(n => n.id === note.id)
        ? curr.filter(n => n.id !== note.id)
        : [...curr, note]
    )
  }

  const updateQty = (noteId, delta) => {
    setPerItemQty(curr => {
      const next = Math.max(1, Math.min(currentQty, (curr[noteId] ?? currentQty) + delta))
      return { ...curr, [noteId]: next }
    })
  }

  const confirm = () => {
    const out = selected.map(n => ({
      ...n,
      qty: perItemQty[n.id] ?? currentQty,
    }))
    onConfirm?.(out)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <style>{`
        @keyframes kds-sheet-up {
          0%   { transform: translateY(100%); }
          100% { transform: translateY(0); }
        }
        @keyframes kds-fade-in {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>

      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Chiudi"
        className="absolute inset-0 bg-black/60"
        style={{ animation: 'kds-fade-in 200ms ease-out' }}
      />

      {/* Sheet */}
      <div
        className="relative w-full max-w-[640px] bg-surface border-t border-borderSoft
                   rounded-t-sheet shadow-lg"
        style={{
          transform: enter ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 300ms cubic-bezier(.2,.7,.2,1)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1.5 rounded-full bg-borderSoft" />
        </div>

        {/* Header */}
        <header className="flex items-center justify-between px-4 pt-2 pb-3 border-b border-borderSoft">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[1.6px] text-textMute">
              Note cottura
            </p>
            <h2 className="font-display text-[22px] text-text leading-tight truncate">
              {dishName}
              <span className="text-textSoft text-[14px] font-bold ml-2">×{currentQty}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="w-10 h-10 rounded-full bg-bg/50 border border-borderSoft
                       flex items-center justify-center text-textSoft
                       active:scale-90 transition-transform"
          >
            <X size={20} strokeWidth={2.4} />
          </button>
        </header>

        {/* Griglia icone */}
        <div className="px-4 py-4 max-h-[42vh] overflow-y-auto">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            {notes.map(note => {
              const active = selected.some(n => n.id === note.id)
              return (
                <button
                  key={note.id}
                  onClick={() => toggle(note)}
                  className={[
                    'flex flex-col items-center justify-center gap-1.5 min-h-[88px] p-2',
                    'rounded-card border-2 transition-all active:scale-95',
                    active ? 'shadow-md' : 'border-borderSoft bg-surfaceElev',
                  ].join(' ')}
                  style={active ? {
                    background: `${note.color}1F`,
                    borderColor: note.color,
                  } : undefined}
                >
                  <span className="text-[28px] leading-none">{note.icon}</span>
                  <span
                    className="font-extrabold text-[12px] uppercase tracking-[0.6px] text-center leading-tight"
                    style={active ? { color: note.color } : { color: '#C4A882' }}
                  >
                    {note.label}
                  </span>
                  {active && currentQty > 1 && (
                    <QtyStepper
                      value={perItemQty[note.id] ?? currentQty}
                      max={currentQty}
                      color={note.color}
                      onMinus={(e) => { e.stopPropagation(); updateQty(note.id, -1) }}
                      onPlus={(e)  => { e.stopPropagation(); updateQty(note.id, +1) }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center gap-2 px-4 py-3 border-t border-borderSoft bg-bg/40">
          <button
            onClick={onClose}
            className="px-4 h-12 rounded-btn border border-borderSoft text-textSoft
                       font-extrabold text-[14px] uppercase tracking-[1px]
                       active:scale-95 transition-transform"
          >
            Annulla
          </button>
          <button
            onClick={confirm}
            className="flex-1 inline-flex items-center justify-center gap-2
                       h-12 rounded-btn bg-gold text-bg
                       font-extrabold text-[16px] uppercase tracking-[1px]
                       shadow-cta active:scale-[0.98] transition-transform"
          >
            <Check size={18} strokeWidth={2.8} />
            Conferma {selected.length > 0 && `(${selected.length})`}
          </button>
        </footer>
      </div>
    </div>
  )
}

function QtyStepper({ value, max, color, onMinus, onPlus }) {
  return (
    <div
      className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5
                 bg-bg/60 border"
      style={{ borderColor: `${color}66` }}
    >
      <button
        onClick={onMinus}
        className="w-5 h-5 rounded-full bg-bg/80 text-text font-extrabold flex items-center justify-center"
        aria-label="Meno"
      >−</button>
      <span
        className="font-mono font-extrabold text-[12px] tabular-nums min-w-[28px] text-center"
        style={{ color }}
      >
        {value}/{max}
      </span>
      <button
        onClick={onPlus}
        className="w-5 h-5 rounded-full bg-bg/80 text-text font-extrabold flex items-center justify-center"
        aria-label="Piu'"
      >+</button>
    </div>
  )
}

export const DEFAULT_NOTES = [
  { id: 'sangue',       icon: '🩸', label: 'Al sangue',    color: '#E84040' },
  { id: 'media',        icon: '🌡️', label: 'Media',        color: '#F0A820' },
  { id: 'ben_cotta',    icon: '⬛', label: 'Ben cotta',     color: '#8A6E55' },
  { id: 'piccante',     icon: '🌶️', label: 'Piccante',     color: '#E84040' },
  { id: 'no_sale',      icon: '🚫', label: 'Senza sale',   color: '#4FB0E8' },
  { id: 'no_glutine',   icon: '🌾', label: 'No glutine',   color: '#D4A043' },
  { id: 'no_lattosio',  icon: '🥛', label: 'No lattosio',  color: '#FAF5EA' },
  { id: 'no_aglio',     icon: '🧄', label: 'No aglio',     color: '#C4A882' },
]
