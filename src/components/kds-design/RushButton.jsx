import { Zap } from 'lucide-react'

/**
 * RushButton — pulsante "marca come urgente" riutilizzabile.
 *
 * Varianti:
 *   size="sm"  → icona discreta in alto a destra sulla card cameriere
 *   size="md"  → pulsante outline in fondo a sinistra alla card KDS
 *   size="lg"  → full-width per confirm modale (non usato qui)
 *
 * Stato `active`: card e' gia' in rush → stile pieno + blink.
 *
 * onClick(): aspetta che il chiamante mostri una conferma e poi chiami
 * rushOrdine(orderId). Qui dentro non c'e' alcuna logica DB.
 */
export default function RushButton({
  active = false,
  onClick,
  size = 'md',
  label = 'RUSH',
}) {
  if (size === 'sm') {
    return (
      <button
        onClick={onClick}
        aria-label={active ? 'Rimuovi RUSH' : 'Segna come urgente'}
        title={active ? 'RUSH attivo' : 'Segna come urgente'}
        className={[
          'inline-flex items-center justify-center w-9 h-9 rounded-full',
          'border transition-transform active:scale-90',
          active
            ? 'bg-danger text-bg border-danger shadow-alert animate-blink'
            : 'bg-bg/60 text-textSoft border-borderSoft hover:text-danger hover:border-danger',
        ].join(' ')}
      >
        <Zap size={18} strokeWidth={2.5} fill={active ? 'currentColor' : 'none'} />
      </button>
    )
  }

  // size = 'md' (default KDS card)
  return (
    <button
      onClick={onClick}
      aria-label={active ? 'Rimuovi RUSH' : 'Segna come urgente'}
      className={[
        'inline-flex items-center justify-center gap-1.5',
        'px-3 h-11 rounded-btn border-2',
        'font-extrabold text-[14px] uppercase tracking-[1.2px]',
        'transition-transform active:scale-95',
        active
          ? 'bg-danger text-bg border-danger shadow-alert animate-blink'
          : 'bg-transparent text-danger border-danger hover:bg-dangerSoft',
      ].join(' ')}
    >
      <Zap size={18} strokeWidth={3} fill={active ? 'currentColor' : 'none'} />
      <span>{label}</span>
    </button>
  )
}
