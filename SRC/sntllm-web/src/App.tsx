import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useT } from './context/I18nContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { SetupProvider, useSetup } from './context/SetupContext'
import { SidebarRefreshProvider } from './context/SidebarRefreshContext'
import { I18nProvider } from './context/I18nContext'
import { SearchProvider } from './components/SearchContext'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import NotesPage from './pages/NotesPage'
import NoteEditorPage from './pages/NoteEditorPage'
import ProjectsPage from './pages/ProjectsPage'
import OnboardingPage from './pages/OnboardingPage'
import SettingsPage from './pages/SettingsPage'
import ChatPage from './pages/ChatPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

/**
 * Redireciona para /setup se onboarding estiver disponível e o usuário
 * não estiver já na rota /setup.
 */
function SetupGuard({ children }: { children: React.ReactNode }) {
  const { status, loading } = useSetup()
  const navigate = useNavigate()
  const location = useLocation()
  const t = useT()

  useEffect(() => {
    if (loading) return
    if (status?.onboardingAvailable && location.pathname !== '/setup') {
      navigate('/setup', { replace: true })
    }
  }, [status, loading, navigate, location.pathname])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
        <p style={{ color: '#475569', fontSize: 15 }}>{t('app.starting')}</p>
      </div>
    )
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <SetupGuard>
      <Routes>
        <Route path="/setup" element={<OnboardingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/notes" element={<ProtectedRoute><NotesPage /></ProtectedRoute>} />
        <Route path="/notes/:id" element={<ProtectedRoute><NoteEditorPage /></ProtectedRoute>} />
        <Route path="/projects/new" element={<ProtectedRoute><ProjectsPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/chat/new" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
        <Route path="/chat/:id" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SetupGuard>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <I18nProvider>
        <SetupProvider>
          <SidebarRefreshProvider>
            <SearchProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </SearchProvider>
          </SidebarRefreshProvider>
        </SetupProvider>
      </I18nProvider>
    </AuthProvider>
  )
}
