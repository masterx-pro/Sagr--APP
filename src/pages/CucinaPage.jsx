import StationPage from './StationPage.jsx'
import { useExitConfirmGuard } from '../hooks/useExitConfirmGuard.js'

/**
 * CucinaPage: pagina della postazione cucina.
 * Identica al Bar ma con filtro categoria='cucina'.
 */
export default function CucinaPage({ user, onLogout }) {
  useExitConfirmGuard(onLogout)
  return (
    <StationPage
      user={user}
      onLogout={onLogout}
      categoria="cucina"
      role="cucina"
      titolo="Cucina live"
    />
  )
}
