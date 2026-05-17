import { useState } from 'react'

/**
 * PinPad — tastiera numerica dark-theme.
 *
 * Layout:
 *  - Logo box wine→wineDeep (70×70) con "S" gold serif italic
 *  - Titolo "Sagr" + "à" gold italic + "App" in DM Serif Display
 *  - PIN dots gold filled con glow
 *  - Tasti 86×86px (più compatti in landscape)
 *  - "C" e "⌫" come action keys (background trasparente)
 */
export default function PinPad({ onSubmit, loading, error, header = null, subtitle = 'Inserisci PIN' }) {
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

  const keys = ['1','2','3','4','5','6','7','8','9','C','0','⌫']

  const Logo = (
    <div className="text-center">
      <div className="w-[70px] h-[70px] mx-auto rounded-[20px] flex items-center justify-center
                      font-display text-gold italic text-[38px] tracking-[-1px]
                      shadow-[0_6px_18px_rgba(160,48,44,0.35),inset_0_1px_0_rgba(255,255,255,0.1)]
                      bg-gradient-to-br from-wine to-wineDeep">
        S
      </div>
      <div className="font-display text-[32px] mt-3.5 tracking-[-0.4px] text-text leading-none">
        Sagr<span className="text-gold italic">à</span>App
      </div>
      <div className="text-[13px] text-textSoft mt-1 font-semibold tracking-[0.4px]">
        {subtitle}
      </div>
    </div>
  )

  const Dots = (
    <div className="flex items-center justify-center gap-4">
      {Array.from({ length: maxLen }).map((_, i) => {
        const filled = i < pin.length
        return (
          <div
            key={i}
            className={`w-[18px] h-[18px] rounded-full transition-all
                        ${filled
                          ? 'bg-gold border-2 border-gold shadow-[0_0_0_4px_rgba(212,160,67,0.25)]'
                          : 'bg-transparent border-2 border-border'}`}
          />
        )
      })}
    </div>
  )

  const ErrBlock = error && (
    <p className="text-center text-danger text-sm font-semibold">
      {error}
    </p>
  )

  const Keypad = (
    <div className="grid grid-cols-3 gap-3.5 mobile-landscape:gap-2">
      {keys.map((k) => {
        const isAction = k === 'C' || k === '⌫'
        const onClick = k === 'C' ? clear : k === '⌫' ? back : () => press(k)
        return (
          <button
            key={k}
            type="button"
            onClick={onClick}
            className={`w-[86px] h-[86px] rounded-[24px] tabular-nums
                        mobile-landscape:w-16 mobile-landscape:h-12 mobile-landscape:rounded-2xl
                        ${isAction
                          ? 'bg-transparent border-[1.5px] border-borderSoft text-textSoft text-[22px]'
                          : 'bg-surface border-[1.5px] border-border text-text text-[30px] shadow-md'}
                        font-semibold active:scale-95 transition-transform`}
          >
            {k}
          </button>
        )
      })}
    </div>
  )

  const SubmitBtn = (
    <button
      type="button"
      onClick={submit}
      disabled={pin.length < 4 || loading}
      className="w-full min-h-btn rounded-btn font-extrabold text-lg tracking-wide
                 bg-gold text-bg active:scale-95 transition-transform
                 disabled:opacity-40 disabled:active:scale-100 shadow-cta"
    >
      {loading ? 'Verifica…' : 'Entra'}
    </button>
  )

  return (
    <>
      {/* PORTRAIT */}
      <div className="w-full max-w-sm mx-auto mobile-landscape:hidden
                      flex flex-col items-center gap-6">
        {header || Logo}
        {Dots}
        {ErrBlock}
        {Keypad}
        <div className="w-full">{SubmitBtn}</div>
      </div>

      {/* MOBILE LANDSCAPE */}
      <div className="hidden mobile-landscape:flex w-full max-w-2xl mx-auto
                      flex-row-reverse items-center gap-6">
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-3">
          {header || Logo}
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
