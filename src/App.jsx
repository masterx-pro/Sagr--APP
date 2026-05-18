import { useEffect, useState, useCallback, useMemo } from 'react'
import LoginPage from './pages/LoginPage.jsx'
import CamerierePage from './pages/CamerierePage.jsx'
import BarPage from './pages/BarPage.jsx'
import CucinaPage from './pages/CucinaPage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import CassaPage from './pages/CassaPage.jsx'
import Tutorial from './components/Tutorial.jsx'
import { getTutorial } from './data/tutorial.js'
import { ImpostazioniProvider } from './context/ImpostazioniContext.jsx'

/**
 * App: legge l'utente da localStorage e instrada
 * verso la pagina del ruolo corretto.
 *
 * Tutorial:
 *   - Al primo login per un ruolo (localStorage "tutorial_visto_<ruolo>" assente)
 *     si apre automaticamente; a fine/skip salva il flag.
 */

function tutorialKey(ruolo) { return `tutorial_visto_${ruolo}` }

export default function App() {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('festaUser')
      if (raw) setUser(JSON.parse(raw))
    } catch (e) {
      console.error('Errore lettura festaUser', e)
    }
    setReady(true)
  }, [])

  const handleLogin = useCallback((u) => {
    localStorage.setItem('festaUser', JSON.stringify(u))
    setUser(u)
    // Primo accesso: se non c'è il flag, apri il tutorial
    try {
      if (u?.ruolo && !localStorage.getItem(tutorialKey(u.ruolo))) {
        setTutorialOpen(true)
      }
    } catch { /* ignore */ }
  }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem('festaUser')
    setUser(null)
    setTutorialOpen(false)
  }, [])

  // Slide del tutorial corrente
  const slidesCorrente = useMemo(
    () => (user?.ruolo ? getTutorial(user.ruolo) : []),
    [user]
  )

  const chiudiTutorialAutomatico = useCallback(() => {
    setTutorialOpen(false)
    try {
      if (user?.ruolo) localStorage.setItem(tutorialKey(user.ruolo), 'true')
    } catch { /* ignore */ }
  }, [user])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg opacity-70">Caricamento…</p>
      </div>
    )
  }

  if (!user) return <LoginPage onLogin={handleLogin} />

  const page = (() => {
    switch (user.ruolo) {
      case 'cameriere': return <CamerierePage user={user} onLogout={handleLogout} />
      case 'bar':       return <BarPage user={user} onLogout={handleLogout} />
      case 'cucina':    return <CucinaPage user={user} onLogout={handleLogout} />
      case 'cassa':     return <CassaPage user={user} onLogout={handleLogout} />
      case 'admin':     return <AdminPage user={user} onLogout={handleLogout} />
      default:
        return (
          <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
            <p className="text-red-400">Ruolo sconosciuto: {user.ruolo}</p>
            <button onClick={handleLogout} className="btn-danger">Esci</button>
          </div>
        )
    }
  })()

  return (
    <ImpostazioniProvider>
      {page}

      {/* Tutorial overlay (apertura automatica al primo accesso per ruolo) */}
      {tutorialOpen && slidesCorrente.length > 0 && (
        <Tutorial
          slides={slidesCorrente}
          onClose={chiudiTutorialAutomatico}
        />
      )}
    </ImpostazioniProvider>
  )
}
