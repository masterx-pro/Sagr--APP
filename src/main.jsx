import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Auto-reload appena un nuovo Service Worker prende il controllo
// (cioe' dopo skipWaiting + clientsClaim del SW appena deployato).
// Cosi' i dispositivi vedono subito la nuova versione senza svuotare
// manualmente la cache.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
