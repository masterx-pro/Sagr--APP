import StationPage from './StationPage.jsx'
import { useExitConfirmGuard } from '../hooks/useExitConfirmGuard.js'

/**
 * BarPage: pagina della postazione bar.
 * Mostra in realtime gli item con categoria='bar' non ancora pronti.
 */
export default function BarPage({ user, onLogout }) {
  useExitConfirmGuard(onLogout)
  return (
    <StationPage
      user={user}
      onLogout={onLogout}
      categoria="bar"
      titolo="Bar"
      coloreHeader="bg-bar"
    />
  )
}
