import { useEffect } from 'react'

/**
 * Aggiunge una protezione sul tasto INDIETRO del telefono:
 * al mount fa una pushState così il primo back genera un popstate;
 * sul popstate mostra un confirm e, se l'utente conferma, esegue
 * onConfirmExit (tipicamente il logout). Se annulla, ripristina la
 * voce di history per restare nella pagina.
 *
 * Pulisce automaticamente il listener al unmount.
 */
export function useExitConfirmGuard(onConfirmExit) {
  useEffect(() => {
    window.history.pushState(null, '', window.location.href)
    const onPop = () => {
      const ok = window.confirm('Vuoi uscire e tornare al login?')
      if (ok) {
        onConfirmExit()
      } else {
        window.history.pushState(null, '', window.location.href)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [onConfirmExit])
}
