import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { translate, type Lang } from '../i18n'
import { useAuth } from './AuthContext'

// Storage key: sntllm_lang_{userId} or sntllm_lang (unauthenticated)
function storageKey(userId?: string) {
  return userId ? `sntllm_lang_${userId}` : 'sntllm_lang'
}

function readLang(userId?: string): Lang {
  const stored = localStorage.getItem(storageKey(userId))
  if (stored === 'pt_BR' || stored === 'en_US' || stored === 'es') return stored
  return 'pt_BR'
}

interface I18nContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string, params?: Record<string, string>) => string
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'pt_BR',
  setLang: () => {},
  t: (key) => key,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [lang, setLangState] = useState<Lang>(() => readLang(user?.userId))

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem(storageKey(user?.userId), l)
  }, [user?.userId])

  const t = useCallback(
    (key: string, params?: Record<string, string>) => translate(lang, key, params),
    [lang]
  )

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}

/** Convenience hook — returns just the translator function */
export function useT() {
  return useContext(I18nContext).t
}
