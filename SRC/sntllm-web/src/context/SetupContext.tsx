import { useState, useEffect, createContext, useContext, type ReactNode } from 'react'
import api from '../api/client'

interface SetupStatus {
  onboardingAvailable: boolean
  remainingSeconds: number
  reason: string
}

interface SystemSettings {
  baseUrl?: string
  searxUrl?: string
}

interface SetupContextValue {
  status: SetupStatus | null
  settings: SystemSettings | null
  loading: boolean
  refresh: () => void
}

const SetupContext = createContext<SetupContextValue | null>(null)

export function SetupProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [loading, setLoading] = useState(true)

  function refresh() {
    setLoading(true)
    
    const statusPromise = api.get<SetupStatus>('/setup/status')
      .then(r => setStatus(r.data))
      .catch(() => setStatus({ onboardingAvailable: false, remainingSeconds: 0, reason: 'error' }))

    const settingsPromise = api.get<Record<string, string>>('/admin/settings')
      .then(r => {
        setSettings({
          baseUrl: r.data['system.baseUrl'],
          searxUrl: r.data['system.searxUrl']
        })
      })
      .catch(err => {
        // Silenciar erro 401 aqui para evitar loop de login
        if (err.response?.status !== 401) {
          console.error('Erro ao carregar configurações de sistema:', err)
        }
        setSettings(null)
      })

    Promise.all([statusPromise, settingsPromise]).finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [])

  return (
    <SetupContext.Provider value={{ status, settings, loading, refresh }}>
      {children}
    </SetupContext.Provider>
  )
}

export function useSetup() {
  const ctx = useContext(SetupContext)
  if (!ctx) throw new Error('useSetup must be used inside SetupProvider')
  return ctx
}
