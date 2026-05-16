import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Tutorial fullscreen per i nuovi utenti.
 *
 * Props:
 *   - slides:  array di { id, immagine, titolo, descrizione, evidenzia }
 *              (evidenzia = { x, y, raggio } in % sull'immagine, oppure null)
 *   - onClose: chiamata quando l'utente skippa o completa
 *   - autoAdvanceMs: default 5000 (auto-avanzamento). Passa 0 per disabilitare.
 *
 * Comportamento:
 *   - Tap sull'immagine → avanti
 *   - Pulsanti Indietro / Salta / Avanti — ultima slide: "Ho capito!"
 *   - Auto-avanzamento ogni 5s con barra che si svuota; si resetta a ogni
 *     interazione (click, swipe, pulsante)
 */
export default function Tutorial({ slides, onClose, autoAdvanceMs = 5000 }) {
  const [index, setIndex] = useState(0)
  const [autoLeft, setAutoLeft] = useState(autoAdvanceMs)
  const [paused, setPaused] = useState(false)

  const total = slides?.length || 0
  const slide = slides?.[index]
  const isLast = index === total - 1

  // ---------------- AUTO-ADVANCE ----------------
  const lastTickRef = useRef(Date.now())
  const rafRef = useRef(null)

  const resetAuto = useCallback(() => {
    setAutoLeft(autoAdvanceMs)
    lastTickRef.current = Date.now()
  }, [autoAdvanceMs])

  useEffect(() => { resetAuto() }, [index, resetAuto])

  useEffect(() => {
    if (autoAdvanceMs <= 0 || paused || isLast) return
    const tick = () => {
      const now = Date.now()
      const dt = now - lastTickRef.current
      lastTickRef.current = now
      setAutoLeft(prev => {
        const next = prev - dt
        if (next <= 0) {
          setIndex(i => Math.min(total - 1, i + 1))
          return autoAdvanceMs
        }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [paused, isLast, total, autoAdvanceMs])

  // ---------------- NAVIGAZIONE ----------------
  const goNext = () => {
    resetAuto()
    if (isLast) onClose()
    else setIndex(i => Math.min(total - 1, i + 1))
  }
  const goPrev = () => {
    resetAuto()
    setIndex(i => Math.max(0, i - 1))
  }
  const skip = () => {
    resetAuto()
    onClose()
  }

  // ---------------- SWIPE ----------------
  const startX = useRef(null)
  const onTouchStart = (e) => { startX.current = e.touches[0].clientX; setPaused(true) }
  const onTouchEnd = (e) => {
    if (startX.current == null) return
    const dx = e.changedTouches[0].clientX - startX.current
    startX.current = null
    setPaused(false)
    if (dx < -50) goNext()
    else if (dx > 50) goPrev()
  }

  // ---------------- ESCAPE / FRECCE ----------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') skip()
      else if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isLast])

  if (!slide) return null

  const autoPct = autoAdvanceMs > 0 && !isLast && !paused
    ? Math.max(0, Math.min(100, (autoLeft / autoAdvanceMs) * 100))
    : 0

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-stretch
                 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      {/* Barra auto-avanzamento */}
      {autoAdvanceMs > 0 && !isLast && (
        <div className="h-1 bg-white/10 w-full">
          <div
            className="h-full bg-yellow-400 transition-all duration-100 ease-linear"
            style={{ width: `${autoPct}%` }}
          />
        </div>
      )}

      {/* Indicatore slide X/Y + pallini */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-white/70 text-sm font-semibold tracking-wide">
          {index + 1} / {total}
        </span>
        <div className="flex gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => { resetAuto(); setIndex(i) }}
              aria-label={`Vai alla slide ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                i === index ? 'w-6 bg-yellow-400' : 'w-2 bg-white/30 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Slide stack con transizione orizzontale */}
      <div
        className="flex-1 overflow-hidden relative"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((s, i) => (
            <SlideBody
              key={s.id}
              slide={s}
              attiva={i === index}
              onTapImage={goNext}
            />
          ))}
        </div>
      </div>

      {/* Pulsanti */}
      <div className="px-4 py-3 grid grid-cols-3 gap-2 bg-black/40 border-t border-white/10">
        <button
          onClick={goPrev}
          disabled={index === 0}
          className="rounded-xl bg-white/10 text-white font-semibold py-3
                     active:scale-95 disabled:opacity-30 disabled:active:scale-100"
        >
          ← Indietro
        </button>
        <button
          onClick={skip}
          className="rounded-xl bg-white/10 text-white/80 font-semibold py-3
                     active:scale-95"
        >
          Salta
        </button>
        <button
          onClick={goNext}
          className={`rounded-xl font-bold py-3 active:scale-95 ${
            isLast
              ? 'bg-green-600 hover:bg-green-500 text-white animate-pulse'
              : 'bg-yellow-400 hover:bg-yellow-300 text-black'
          }`}
        >
          {isLast ? 'Ho capito! Inizia →' : 'Avanti →'}
        </button>
      </div>
    </div>
  )
}

// -------------------- SLIDE BODY --------------------

function SlideBody({ slide, attiva, onTapImage }) {
  const hasEvidenzia = !!slide.evidenzia
  return (
    <div className="w-full flex-shrink-0 flex flex-col items-center justify-start
                    px-4 py-2 overflow-y-auto">
      <h2 className="text-2xl font-bold text-white text-center mb-3 mt-1
                     leading-tight">
        {slide.titolo}
      </h2>

      <div
        className="relative w-full max-w-md mx-auto rounded-2xl overflow-hidden
                   shadow-2xl border border-white/10 bg-white/5 cursor-pointer
                   active:scale-[0.99] transition-transform"
        style={{ maxHeight: '60vh' }}
        onClick={onTapImage}
      >
        {slide.immagine ? (
          <img
            src={slide.immagine}
            alt={slide.titolo}
            className="w-full h-auto block"
            style={{ maxHeight: '60vh', objectFit: 'contain' }}
            loading={attiva ? 'eager' : 'lazy'}
            onError={(e) => {
              // Fallback se l'immagine è mancante
              e.currentTarget.style.display = 'none'
              const fallback = e.currentTarget.nextElementSibling
              if (fallback) fallback.style.display = 'flex'
            }}
          />
        ) : null}
        <div
          className="w-full bg-gradient-to-br from-indigo-700 to-fuchsia-700
                     text-white font-bold text-center text-lg p-8
                     flex items-center justify-center"
          style={{
            display: slide.immagine ? 'none' : 'flex',
            minHeight: '220px',
          }}
        >
          {slide.titolo}
        </div>

        {/* Cerchio evidenziatore */}
        {hasEvidenzia && (
          <span
            className="absolute pointer-events-none rounded-full
                       border-4 border-yellow-300 animate-ping"
            style={{
              left: `${slide.evidenzia.x}%`,
              top: `${slide.evidenzia.y}%`,
              width: `${slide.evidenzia.raggio * 2}%`,
              aspectRatio: '1 / 1',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.0)',
            }}
            aria-hidden="true"
          />
        )}
        {hasEvidenzia && (
          <span
            className="absolute pointer-events-none rounded-full
                       border-4 border-yellow-400"
            style={{
              left: `${slide.evidenzia.x}%`,
              top: `${slide.evidenzia.y}%`,
              width: `${slide.evidenzia.raggio * 2}%`,
              aspectRatio: '1 / 1',
              transform: 'translate(-50%, -50%)',
            }}
            aria-hidden="true"
          />
        )}
      </div>

      <p className="text-white/90 text-base text-center mt-4 max-w-md
                    leading-relaxed">
        {slide.descrizione}
      </p>

      <p className="text-white/40 text-xs text-center mt-2 italic">
        Tappa l'immagine o usa → per la slide successiva
      </p>
    </div>
  )
}
