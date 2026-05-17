import { useState } from 'react'
import PinPad from '../components/PinPad.jsx'
import { supabase } from '../supabaseClient.js'

/**
 * LoginPage — PIN login. Lookup su tabella users.
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
    <div className="min-h-screen flex flex-col items-center justify-between
                    py-12 px-6 mobile-landscape:py-4
                    bg-bg text-text">
      <div className="flex-1 w-full flex items-center justify-center">
        <PinPad
          onSubmit={handleSubmit}
          loading={loading}
          error={error}
          subtitle="Inserisci PIN"
        />
      </div>

      <div className="mt-4 text-center text-[11px] text-textMute font-semibold tracking-[1px]">
        <p>SAGRA · v2.4.1</p>
        <p className="mt-1 opacity-80">
          Sviluppato da Mattia Prosperi —{' '}
          <a
            href="mailto:masterxpro@gmail.com"
            className="hover:text-textSoft underline"
          >
            masterxpro@gmail.com
          </a>
        </p>
      </div>
    </div>
  )
}
