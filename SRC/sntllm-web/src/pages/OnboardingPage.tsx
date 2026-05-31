import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

interface SetupStatus {
  onboardingAvailable: boolean
  remainingSeconds: number
  reason: string
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [remaining, setRemaining] = useState(0)

  const [userName, setUserName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Verifica status ao montar
  useEffect(() => {
    api.get<SetupStatus>('/setup/status').then(r => {
      setStatus(r.data)
      setRemaining(r.data.remainingSeconds)
      if (!r.data.onboardingAvailable) navigate('/login', { replace: true })
    }).catch(() => navigate('/login', { replace: true }))
  }, [navigate])

  // Countdown regressivo
  useEffect(() => {
    if (!status?.onboardingAvailable || remaining <= 0) return
    const interval = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          navigate('/login', { replace: true })
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [status, navigate, remaining])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }
    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.')
      return
    }

    setLoading(true)
    try {
      const { data } = await api.post('/setup/admin', { userName, email, password })
      login(data.accessToken, {
        userId: data.userId,
        userName: data.userName,
        email: data.email,
        role: data.role,
      })
      setDone(true)
      setTimeout(() => navigate('/', { replace: true }), 2000)
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Erro ao criar conta de administrador.')
    } finally {
      setLoading(false)
    }
  }

  if (!status) {
    return (
      <div style={styles.screen}>
        <p style={styles.checking}>Verificando sistema...</p>
      </div>
    )
  }

  if (done) {
    return (
      <div style={styles.screen}>
        <div style={styles.successBox}>
          <div style={styles.successIcon}>✅</div>
          <h2 style={styles.successTitle}>Conta de admin criada!</h2>
          <p style={styles.successSub}>Redirecionando para o dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.screen}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.headerBadge}>
          <span style={styles.badgeText}>🛠️ Configuração inicial</span>
          <span style={styles.timer} title="Janela de onboarding se fecha em...">
            ⏱ {formatTime(remaining)}
          </span>
        </div>

        <h1 style={styles.title}>📓 SomeNoteTaking</h1>
        <p style={styles.subtitle}>
          Nenhum administrador encontrado. Crie a conta de administrador para começar.
          Esta tela ficará disponível por <strong style={{ color: '#fbbf24' }}>10 minutos</strong> desde o início do sistema.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Nome de usuário</label>
            <input
              style={styles.input}
              value={userName}
              onChange={e => setUserName(e.target.value)}
              placeholder="admin"
              required
              minLength={2}
              autoFocus
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              style={styles.input}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@exemplo.com"
              required
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Senha</label>
            <input
              type="password"
              style={styles.input}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              required
              minLength={8}
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Confirmar senha</label>
            <input
              type="password"
              style={styles.input}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Repita a senha"
              required
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Criando conta...' : 'Criar conta de administrador'}
          </button>
        </form>

        <p style={styles.warning}>
          ⚠️ Após criar o administrador, este formulário não estará mais disponível.
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
    padding: '1.5rem',
  },
  checking: { color: '#94a3b8', fontSize: 16 },
  card: {
    background: '#1e293b',
    borderRadius: 16,
    padding: '2.5rem',
    width: '100%',
    maxWidth: 460,
    boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
    border: '1px solid #334155',
  },
  headerBadge: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
    padding: '0.5rem 0.875rem',
    background: '#0f172a',
    borderRadius: 8,
    border: '1px solid #334155',
  },
  badgeText: { color: '#94a3b8', fontSize: 13, fontWeight: 500 },
  timer: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.05em',
  },
  title: {
    color: '#f8fafc',
    fontSize: 26,
    fontWeight: 800,
    textAlign: 'center',
    marginBottom: '0.75rem',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 1.6,
    marginBottom: '2rem',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { color: '#94a3b8', fontSize: 13, fontWeight: 500 },
  input: {
    padding: '0.75rem',
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#0f172a',
    color: '#f8fafc',
    fontSize: 15,
    outline: 'none',
  },
  error: { color: '#f87171', fontSize: 13, margin: 0 },
  button: {
    padding: '0.9rem',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    border: 'none',
    cursor: 'pointer',
    marginTop: 8,
    letterSpacing: '0.02em',
  },
  warning: {
    marginTop: '1.5rem',
    color: '#475569',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  successBox: {
    background: '#1e293b',
    borderRadius: 16,
    padding: '3rem',
    textAlign: 'center',
    border: '1px solid #334155',
  },
  successIcon: { fontSize: 48, marginBottom: '1rem' },
  successTitle: { color: '#f8fafc', fontSize: 22, fontWeight: 700, marginBottom: 8 },
  successSub: { color: '#94a3b8', fontSize: 15 },
}
