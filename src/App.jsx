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
 *   - Il pulsante "?" in basso a destra lo riapre manualmente in qualsiasi
 *     momento senza toccare il flag.
 */

// Colore del FAB "?" per ruolo (corrisponde all'header della pagina)
const COLORE_FAB = {
  cameriere: 'bg-cameriere',
  bar:       'bg-bar',
  cucina:    'bg-cucina',
  cassa:     'bg-cassa',
  admin:     'bg-admin',
}

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

  const chiudiTutorialManuale = useCallback(() => {
    // Non aggiorna il flag — il prossimo primo-accesso lo riaprirà comunque
    setTutorialOpen(false)
  }, [])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg opacity-70">Caricamento…</p>
      </div>
    )
  }

  if (!user) return <LoginPage onLogin={handleLogin} />

  // Distinguo i due flussi di chiusura tramite stato: la chiusura via
  // pulsante "?" usa "manuale", la prima volta dopo login usa "automatico".
  // Per semplicità: se il flag NON c'è quando il tutorial è aperto → automatico.
  const isPrimoAccesso = (() => {
    try { return !localStorage.getItem(tutorialKey(user.ruolo)) }
    catch { return false }
  })()

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

  const colorFab = COLORE_FAB[user.ruolo] || 'bg-pannello'

  return (
    <ImpostazioniProvider>
      {page}

      {/* FAB pulsante ? — apre il tutorial manualmente */}
      {slidesCorrente.length > 0 && !tutorialOpen && (
        <button
          onClick={() => setTutorialOpen(true)}
          aria-label="Apri tutorial"
          title="Apri tutorial"
          className={`fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full
                      ${colorFab} text-white text-2xl font-bold shadow-lg
                      active:scale-95 transition-transform border-2 border-white/20`}
        >
          ?
        </button>
      )}

      {/* Tutorial overlay */}
      {tutorialOpen && slidesCorrente.length > 0 && (
        <Tutorial
          slides={slidesCorrente}
          onClose={isPrimoAccesso ? chiudiTutorialAutomatico : chiudiTutorialManuale}
        />
      )}
    </ImpostazioniProvider>
  )
}
