import StationPageKDS from '../components/kds-design/StationPageKDS.jsx'
import { useExitConfirmGuard } from '../hooks/useExitConfirmGuard.js'

/**
 * CucinaPage: pagina della postazione cucina.
 * Usa il nuovo design KDS v2 (3 colonne landscape). Il Bar resta su
 * StationPage legacy finché il nuovo layout non è validato in produzione.
 */
export default function CucinaPage({ user, onLogout }) {
  useExitConfirmGuard(onLogout)
  return (
    <StationPageKDS
      user={user}
      onLogout={onLogout}
      categoria="cucina"
      role="cucina"
      titolo="Cucina live"
    />
  )
}
