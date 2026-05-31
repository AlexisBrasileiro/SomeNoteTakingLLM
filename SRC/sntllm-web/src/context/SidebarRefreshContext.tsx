import { createContext, useContext, useState, useCallback } from 'react'

interface SidebarRefreshContextValue {
  version: number
  refresh: () => void
}

const SidebarRefreshContext = createContext<SidebarRefreshContextValue>({
  version: 0,
  refresh: () => {},
})

export function SidebarRefreshProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion(v => v + 1), [])
  return (
    <SidebarRefreshContext.Provider value={{ version, refresh }}>
      {children}
    </SidebarRefreshContext.Provider>
  )
}

export function useSidebarRefresh() {
  return useContext(SidebarRefreshContext)
}
