import { useState } from 'react'

/**
 * PinPad: tastiera numerica grande per login.
 * - Portrait: layout verticale (header → dots → tasti → Entra)
 * - Mobile-landscape (max-height 500px): 2 colonne (tasti a sinistra,
 *   logo + dots + Entra a destra), tasti più compatti
 * Il PIN è di lunghezza 4 (operatori) o 6 (admin).
 */
export default function PinPad({ onSubmit, loading, error, header = null }) {
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

  const dotBtnCls = `rounded-full border-2 border-bordo transition-colors
                     w-6 h-6 mobile-landscape:w-4 mobile-landscape:h-4`

  const Dots = (
    <div className="flex items-center justify-center gap-3
                    mobile-landscape:gap-2 mobile-landscape:mb-2">
      {Array.from({ length: maxLen }).map((_, i) => {
        const filled = i < pin.length
        return (
          <div
            key={i}
            className={`${dotBtnCls} ${filled ? 'bg-white' : 'bg-transparent'}`}
          />
        )
      })}
    </div>
  )

  const keyBtnCls = `text-2xl font-bold rounded-2xl
                     bg-pannello border border-bordo
                     active:scale-95 transition-transform
                     h-16 mobile-landscape:h-11 mobile-landscape:text-xl
                     mobile-landscape:rounded-xl`
  const altBtnCls = `text-base font-semibold rounded-2xl
                     bg-pannello border border-bordo
                     active:scale-95 transition-transform
                     h-16 mobile-landscape:h-11
                     mobile-landscape:rounded-xl`

  const Keypad = (
    <div className="grid grid-cols-3 gap-3 mobile-landscape:gap-2">
      {keys.map(k => (
        <button key={k} type="button" onClick={() => press(k)} className={keyBtnCls}>
          {k}
        </button>
      ))}
      <button type="button" onClick={clear} className={`${altBtnCls} text-red-300`}>C</button>
      <button type="button" onClick={() => press('0')} className={keyBtnCls}>0</button>
      <button type="button" onClick={back} className={altBtnCls}>←</button>
    </div>
  )

  const ErrBlock = error && (
    <p className="text-center text-red-400 text-sm mb-3 mobile-landscape:mb-1">
      {error}
    </p>
  )

  const SubmitBtn = (
    <button
      type="button"
      onClick={submit}
      disabled={pin.length < 4 || loading}
      className="btn-primary w-full text-lg"
    >
      {loading ? 'Verifica…' : 'Entra'}
    </button>
  )

  return (
    <>
      {/* Layout PORTRAIT (e tablet/desktop, sempre tranne mobile landscape) */}
      <div className="w-full max-w-sm mx-auto mobile-landscape:hidden">
        {header && (
          <div className="text-center mb-6">{header}</div>
        )}
        <div className="mb-6 h-14 flex items-center justify-center">{Dots}</div>
        {ErrBlock}
        {Keypad}
        <div className="mt-6">{SubmitBtn}</div>
      </div>

      {/* Layout MOBILE LANDSCAPE: 2 colonne */}
      <div className="hidden mobile-landscape:flex w-full max-w-2xl mx-auto
                      flex-row-reverse items-center gap-6">
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
          {header && (
            <div className="text-center">{header}</div>
          )}
          {Dots}
          {ErrBlock}
          {SubmitBtn}
        </div>
        <div className="flex-1 min-w-0">
          {Keypad}
        </div>
      </div>
    </>
  )
}
