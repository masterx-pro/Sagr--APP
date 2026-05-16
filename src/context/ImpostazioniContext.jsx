import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'

const ImpostazioniContext = createContext({
  impostazioni: {},
  loading: true,
  reload: async () => {},
})

export function ImpostazioniProvider({ children }) {
  const [impostazioni, setImpostazioni] = useState({})
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('impostazioni')
        .select('chiave, valore')
      if (error) throw error
      const map = {}
      for (const row of data || []) map[row.chiave] = row.valore
      setImpostazioni(map)
    } catch (e) {
      console.error('Errore caricamento impostazioni', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    const channel = supabase
      .channel('impostazioni-global')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'impostazioni' },
        () => reload())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [reload])

  return (
    <ImpostazioniContext.Provider value={{ impostazioni, loading, reload }}>
      {children}
    </ImpostazioniContext.Provider>
  )
}

export function useImpostazioni() {
  return useContext(ImpostazioniContext)
}
