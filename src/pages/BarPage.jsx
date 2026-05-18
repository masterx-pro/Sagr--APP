import StationPageKDS from '../components/kds-design/StationPageKDS.jsx'
import { useExitConfirmGuard } from '../hooks/useExitConfirmGuard.js'

/**
 * BarPage: pagina della postazione bar.
 * Usa il nuovo design KDS v2 (3 colonne landscape). Il gradiente arancione
 * è gestito da KDSLayout via role='bar'.
 */
export default function BarPage({ user, onLogout }) {
  useExitConfirmGuard(onLogout)
  return (
    <StationPageKDS
      user={user}
      onLogout={onLogout}
      categoria="bar"
    />
  )
}
