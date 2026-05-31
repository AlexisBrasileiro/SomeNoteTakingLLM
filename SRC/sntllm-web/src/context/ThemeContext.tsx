import { createContext, useContext, useEffect, useCallback, type ReactNode } from 'react'
import api from '../api/client'

export interface ThemeDefinition {
  name: string
  displayName: string
  colors: {
    '--bg-primary': string
    '--bg-sidebar': string
    '--bg-card': string
    '--bg-elevated': string
    '--text-primary': string
    '--text-secondary': string
    '--text-muted': string
    '--accent': string
    '--accent-hover': string
    '--border': string
    '--danger': string
    '--success': string
  }
}

const DARK_COLORS: ThemeDefinition['colors'] = {
  '--bg-primary': '#0f172a',
  '--bg-sidebar': '#1e293b',
  '--bg-card': '#1e293b',
  '--bg-elevated': '#334155',
  '--text-primary': '#f8fafc',
  '--text-secondary': '#e2e8f0',
  '--text-muted': '#64748b',
  '--accent': '#6366f1',
  '--accent-hover': '#4f46e5',
  '--border': '#334155',
  '--danger': '#f87171',
  '--success': '#34d399',
}

export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    name: 'dark',
    displayName: 'Dark',
    colors: DARK_COLORS,
  },
  {
    name: 'light',
    displayName: 'Light',
    colors: {
      '--bg-primary': '#f8fafc',
      '--bg-sidebar': '#f1f5f9',
      '--bg-card': '#ffffff',
      '--bg-elevated': '#e2e8f0',
      '--text-primary': '#0f172a',
      '--text-secondary': '#1e293b',
      '--text-muted': '#64748b',
      '--accent': '#6366f1',
      '--accent-hover': '#4f46e5',
      '--border': '#cbd5e1',
      '--danger': '#ef4444',
      '--success': '#10b981',
    },
  },
  {
    name: 'dracula',
    displayName: 'Dracula',
    colors: {
      '--bg-primary': '#282a36',
      '--bg-sidebar': '#21222c',
      '--bg-card': '#21222c',
      '--bg-elevated': '#44475a',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#cdd6f4',
      '--text-muted': '#6272a4',
      '--accent': '#bd93f9',
      '--accent-hover': '#a679f5',
      '--border': '#44475a',
      '--danger': '#ff5555',
      '--success': '#50fa7b',
    },
  },
  {
    name: 'monokai',
    displayName: 'Monokai',
    colors: {
      '--bg-primary': '#272822',
      '--bg-sidebar': '#1e1f1c',
      '--bg-card': '#1e1f1c',
      '--bg-elevated': '#3e3d32',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#cfcfc2',
      '--text-muted': '#75715e',
      '--accent': '#a6e22e',
      '--accent-hover': '#8cc220',
      '--border': '#3e3d32',
      '--danger': '#f92672',
      '--success': '#a6e22e',
    },
  },
  {
    name: 'solarized-dark',
    displayName: 'Solarized Dark',
    colors: {
      '--bg-primary': '#002b36',
      '--bg-sidebar': '#073642',
      '--bg-card': '#073642',
      '--bg-elevated': '#083f4d',
      '--text-primary': '#fdf6e3',
      '--text-secondary': '#eee8d5',
      '--text-muted': '#657b83',
      '--accent': '#268bd2',
      '--accent-hover': '#1a6fa8',
      '--border': '#073642',
      '--danger': '#dc322f',
      '--success': '#859900',
    },
  },
]

const VSCODE_MAP: Record<string, keyof ThemeDefinition['colors']> = {
  'editor.background': '--bg-primary',
  'sideBar.background': '--bg-sidebar',
  'editor.selectionBackground': '--bg-card',
  'tab.activeBackground': '--bg-elevated',
  'editor.foreground': '--text-primary',
  'sideBar.foreground': '--text-secondary',
  'tab.inactiveForeground': '--text-muted',
  'button.background': '--accent',
  'button.hoverBackground': '--accent-hover',
  'sideBar.border': '--border',
  'errorForeground': '--danger',
  'terminal.ansiGreen': '--success',
}

interface ThemeContextValue {
  currentTheme: ThemeDefinition | null
  applyTheme: (def: ThemeDefinition) => void
  applyBuiltin: (name: string) => void
  importVscodeTheme: (json: string) => ThemeDefinition | Error
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function injectCssVars(colors: ThemeDefinition['colors']) {
  for (const [varName, value] of Object.entries(colors)) {
    document.documentElement.style.setProperty(varName, value)
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const applyTheme = useCallback((def: ThemeDefinition) => {
    injectCssVars(def.colors)
    localStorage.setItem('theme.current', JSON.stringify(def))
    api.put('/admin/settings', {
      settings: { 'theme.current': JSON.stringify(def.colors) },
    }).catch(() => {})
  }, [])

  const applyBuiltin = useCallback((name: string) => {
    const found = BUILTIN_THEMES.find(t => t.name === name)
    if (found) applyTheme(found)
  }, [applyTheme])

  const importVscodeTheme = useCallback((json: string): ThemeDefinition | Error => {
    try {
      const parsed = JSON.parse(json)
      const tokenColors = parsed.colors ?? {}
      const colors: ThemeDefinition['colors'] = { ...DARK_COLORS }

      for (const [vsKey, cssVar] of Object.entries(VSCODE_MAP)) {
        if (tokenColors[vsKey]) {
          // Strip alpha channel if color has 8-digit hex (#RRGGBBAA → #RRGGBB)
          const raw: string = tokenColors[vsKey]
          colors[cssVar] = raw.length === 9 ? raw.slice(0, 7) : raw
        }
      }

      return {
        name: 'vscode-import',
        displayName: parsed.name ?? 'VS Code Import',
        colors,
      }
    } catch (e) {
      return new Error('JSON inválido ou formato não reconhecido.')
    }
  }, [])

  // Load saved theme on mount
  useEffect(() => {
    const saved = localStorage.getItem('theme.current')
    if (saved) {
      try {
        const def: ThemeDefinition = JSON.parse(saved)
        injectCssVars(def.colors)
      } catch {
        injectCssVars(DARK_COLORS)
      }
    } else {
      injectCssVars(DARK_COLORS)
    }
  }, [])

  const currentThemeRaw = localStorage.getItem('theme.current')
  const currentTheme = currentThemeRaw ? JSON.parse(currentThemeRaw) as ThemeDefinition : BUILTIN_THEMES[0]

  return (
    <ThemeContext.Provider value={{ currentTheme, applyTheme, applyBuiltin, importVscodeTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
