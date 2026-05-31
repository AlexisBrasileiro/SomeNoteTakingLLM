import { useState, useEffect, createContext, useContext, type ReactNode } from 'react'
import api from '../api/client'

interface SetupStatus {
  onboardingAvailable: boolean
  remainingSeconds: number
  reason: string
}

interface SetupContextValue {
  status: SetupStatus | null
  loading: boolean
  refresh: () => void
}

const SetupContext = createContext<SetupContextValue | null>(null)

export function SetupProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(true)

  function refresh() {
    setLoading(true)
    api.get<SetupStatus>('/setup/status')
      .then(r => setStatus(r.data))
      .catch(() => setStatus({ onboardingAvailable: false, remainingSeconds: 0, reason: 'error' }))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [])

  return (
    <SetupContext.Provider value={{ status, loading, refresh }}>
      {children}
    </SetupContext.Provider>
  )
}

export function useSetup() {
  const ctx = useContext(SetupContext)
  if (!ctx) throw new Error('useSetup must be used inside SetupProvider')
  return ctx
}
