import { useState } from 'react'
import PinPad from '../components/PinPad.jsx'
import { supabase } from '../supabaseClient.js'

/**
 * LoginPage: tastiera PIN. Lookup su tabella users.
 */
export default function LoginPage({ onLogin }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (pin) => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('users')
      .select('id, nome, ruolo')
      .eq('pin', pin)
      .limit(1)
      .maybeSingle()

    setLoading(false)
    if (error) {
      setError('Errore di connessione')
      return
    }
    if (!data) {
      setError('PIN non valido')
      return
    }
    onLogin(data)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-extrabold tracking-tight">
          Festa Manager
        </h1>
        <p className="opacity-70 mt-2">Inserisci il tuo PIN</p>
      </div>
      <PinPad onSubmit={handleSubmit} loading={loading} error={error} />
    </div>
  )
}
