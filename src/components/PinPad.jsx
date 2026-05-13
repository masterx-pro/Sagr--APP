import { useState } from 'react'

/**
 * PinPad: tastiera numerica grande per login.
 * Il PIN è mascherato e supportato di lunghezza 4 (operatori) o 6 (admin).
 */
export default function PinPad({ onSubmit, loading, error }) {
  const [pin, setPin] = useState('')
  const maxLen = 6

  const press = (n) => {
    if (pin.length >= maxLen) return
    setPin(p => p + n)
  }
  const back = () => setPin(p => p.slice(0, -1))
  const clear = () => setPin('')

  const submit = () => {
    if (pin.length < 4) return
    onSubmit(pin)
  }

  const keys = ['1','2','3','4','5','6','7','8','9']

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="flex items-center justify-center gap-3 mb-6 h-14">
        {Array.from({ length: maxLen }).map((_, i) => {
          const filled = i < pin.length
          return (
            <div
              key={i}
              className={`w-6 h-6 rounded-full border-2 border-bordo transition-colors ${
                filled ? 'bg-white' : 'bg-transparent'
              }`}
            />
          )
        })}
      </div>

      {error && (
        <p className="text-center text-red-400 mb-3 text-sm">{error}</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {keys.map(k => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className="h-16 text-2xl font-bold rounded-2xl
                       bg-pannello border border-bordo
                       active:scale-95 transition-transform"
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={clear}
          className="h-16 text-base font-semibold rounded-2xl
                     bg-pannello border border-bordo text-red-300
                     active:scale-95 transition-transform"
        >
          C
        </button>
        <button
          type="button"
          onClick={() => press('0')}
          className="h-16 text-2xl font-bold rounded-2xl
                     bg-pannello border border-bordo
                     active:scale-95 transition-transform"
        >
          0
        </button>
        <button
          type="button"
          onClick={back}
          className="h-16 text-base font-semibold rounded-2xl
                     bg-pannello border border-bordo
                     active:scale-95 transition-transform"
        >
          ←
        </button>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={pin.length < 4 || loading}
        className="btn-primary w-full mt-6 text-lg"
      >
        {loading ? 'Verifica…' : 'Entra'}
      </button>
    </div>
  )
}
