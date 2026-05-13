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

  const Header = (
    <>
      <h1 className="text-4xl font-extrabold tracking-tight
                     mobile-landscape:text-2xl">
        SagràApp
      </h1>
      <p className="opacity-70 mt-2 mobile-landscape:mt-1 mobile-landscape:text-sm">
        Inserisci il tuo PIN
      </p>
    </>
  )

  return (
    <div className="min-h-screen flex flex-col items-center justify-center
                    p-6 mobile-landscape:p-3">
      <PinPad
        onSubmit={handleSubmit}
        loading={loading}
        error={error}
        header={Header}
      />
    </div>
  )
}
