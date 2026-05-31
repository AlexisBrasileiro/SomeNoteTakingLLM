import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme, BUILTIN_THEMES, type ThemeDefinition } from '../context/ThemeContext'
import AppLayout from '../components/AppLayout'
import api from '../api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserSummary {
  id: string
  userName: string
  email: string
  role: string
  createdAt: string
}

interface ProjectSummaryAdmin {
  id: string
  ownerId: string
  ownerName: string
  name: string
  isArchived: boolean
  paperlessTagId?: number | null
  createdAt: string
}

type Tab = 'users' | 'projects' | 'theme' | 'llm' | 'paperless'

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('users')

  if (user?.role !== 'Admin') {
    navigate('/', { replace: true })
    return null
  }

  return (
    <AppLayout>
      <div style={s.page}>
        <h1 style={s.title}>⚙️ Configurações</h1>
        <div style={s.tabs}>
          {(['users', 'projects', 'theme', 'llm', 'paperless'] as Tab[]).map(t => (
            <button
              key={t}
              style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
              onClick={() => setTab(t)}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>
        <div style={s.content}>
          {tab === 'users'     && <UsersTab />}
          {tab === 'projects'  && <ProjectsTab />}
          {tab === 'theme'     && <ThemeTab />}
          {tab === 'llm'       && <LlmTab />}
          {tab === 'paperless' && <PaperlessTab />}
        </div>
      </div>
    </AppLayout>
  )
}

function tabLabel(t: Tab) {
  return { users: '👤 Usuários', projects: '🗂️ Projetos', theme: '🎨 Personalização', llm: '🤖 LLM (Ollama)', paperless: '📄 Paperless-ng' }[t]
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const load = () => {
    setLoading(true)
    api.get<UserSummary[]>('/admin/users').then(r => { setUsers(r.data); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const changeRole = async (id: string, role: string) => {
    try {
      await api.put(`/admin/users/${id}/role`, { role })
      setMsg('Role atualizada.')
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setMsg(err.response?.data?.message ?? 'Erro ao atualizar role.')
    }
  }

  const deleteUser = async (id: string, name: string) => {
    if (!window.confirm(`Excluir usuário "${name}"?`)) return
    try {
      await api.delete(`/admin/users/${id}`)
      setMsg('Usuário excluído.')
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setMsg(err.response?.data?.message ?? 'Erro ao excluir.')
    }
  }

  return (
    <div>
      {msg && <div style={s.toast}>{msg} <button style={s.toastClose} onClick={() => setMsg('')}>✕</button></div>}
      {loading ? <p style={s.hint}>Carregando...</p> : (
        <table style={s.table}>
          <thead>
            <tr>
              {['Usuário', 'Email', 'Role', 'Criado em', 'Ações'].map(h => <th key={h} style={s.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={s.tr}>
                <td style={s.td}>{u.userName}</td>
                <td style={s.td}>{u.email}</td>
                <td style={s.td}>
                  <select
                    style={s.select}
                    value={u.role}
                    onChange={e => changeRole(u.id, e.target.value)}
                  >
                    {['Admin', 'Manager', 'Contributor', 'Reader'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td style={s.td}>{new Date(u.createdAt).toLocaleDateString('pt-BR')}</td>
                <td style={s.td}>
                  <button style={s.dangerBtn} onClick={() => deleteUser(u.id, u.userName)}>Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Projects Tab ──────────────────────────────────────────────────────────────

function ProjectsTab() {
  const [projects, setProjects] = useState<ProjectSummaryAdmin[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<ProjectSummaryAdmin[]>('/admin/projects').then(r => { setProjects(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const savePaperlessTag = async (projectId: string, tagId: string) => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    await api.put(`/projects/${projectId}`, {
      name: project.name,
      description: '',
      isArchived: project.isArchived,
      paperlessTagId: tagId === '' ? null : parseInt(tagId, 10),
    })
    setProjects(prev => prev.map(p => p.id === projectId
      ? { ...p, paperlessTagId: tagId === '' ? null : parseInt(tagId, 10) }
      : p))
  }

  return (
    <div>
      {loading ? <p style={s.hint}>Carregando...</p> : (
        <table style={s.table}>
          <thead>
            <tr>
              {['Nome', 'Dono', 'Criado em', 'Arquivado', 'Tag Paperless'].map(h => <th key={h} style={s.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} style={s.tr}>
                <td style={s.td}>{p.name}</td>
                <td style={s.td}>{p.ownerName}</td>
                <td style={s.td}>{new Date(p.createdAt).toLocaleDateString('pt-BR')}</td>
                <td style={s.td}>{p.isArchived ? '✅' : '—'}</td>
                <td style={s.td}>
                  <PaperlessTagInput
                    value={p.paperlessTagId ?? null}
                    onSave={(tagId) => savePaperlessTag(p.id, tagId)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PaperlessTagInput({ value, onSave }: { value: number | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value != null ? String(value) : '')
  const [saving, setSaving] = useState(false)

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{value != null ? `#${value}` : <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
        <button style={{ ...s.btn, padding: '2px 8px', fontSize: 11 }} onClick={() => setEditing(true)}>✏️</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        style={{ ...s.input, width: 80, marginBottom: 0, padding: '4px 6px', fontSize: 12 }}
        type="number"
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="ID tag"
        autoFocus
      />
      <button
        style={{ ...s.accentBtn, padding: '4px 8px', fontSize: 11 }}
        disabled={saving}
        onClick={async () => { setSaving(true); await onSave(val); setSaving(false); setEditing(false) }}
      >✔</button>
      <button style={{ ...s.btn, padding: '4px 8px', fontSize: 11 }} onClick={() => setEditing(false)}>✕</button>
    </div>
  )
}

// ── Theme Tab ─────────────────────────────────────────────────────────────────

function ThemeTab() {
  const { currentTheme, applyTheme, applyBuiltin, importVscodeTheme } = useTheme()
  const [vscodeJson, setVscodeJson] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importPreview, setImportPreview] = useState<ThemeDefinition | null>(null)
  const [importError, setImportError] = useState('')
  const [msg, setMsg] = useState('')

  const handlePreview = () => {
    const result = importVscodeTheme(vscodeJson)
    if (result instanceof Error) {
      setImportError(result.message)
      setImportPreview(null)
    } else {
      setImportError('')
      setImportPreview(result)
    }
  }

  const handleApplyImport = () => {
    if (!importPreview) return
    applyTheme(importPreview)
    setMsg('Tema importado aplicado!')
    setShowImport(false)
    setImportPreview(null)
    setVscodeJson('')
  }

  return (
    <div>
      {msg && <div style={s.toast}>{msg} <button style={s.toastClose} onClick={() => setMsg('')}>✕</button></div>}
      <h3 style={s.sectionTitle}>Temas Built-in</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        {BUILTIN_THEMES.map(theme => {
          const isActive = currentTheme?.name === theme.name
          return (
            <button
              key={theme.name}
              onClick={() => { applyBuiltin(theme.name); setMsg(`Tema "${theme.displayName}" aplicado!`) }}
              style={{
                ...s.themeCard,
                border: isActive ? `2px solid ${theme.colors['--accent']}` : '2px solid transparent',
                outline: isActive ? `2px solid ${theme.colors['--accent']}` : 'none',
              }}
            >
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {(['--bg-primary', '--bg-sidebar', '--accent', '--text-primary'] as const).map(v => (
                  <div key={v} style={{ width: 18, height: 18, borderRadius: 4, background: theme.colors[v] }} />
                ))}
              </div>
              <span style={{ fontSize: 12, color: theme.colors['--text-primary'], background: theme.colors['--bg-primary'], padding: '2px 6px', borderRadius: 4 }}>
                {theme.displayName}
              </span>
            </button>
          )
        })}
      </div>

      <button style={s.btn} onClick={() => setShowImport(v => !v)}>
        📂 Importar tema VS Code
      </button>

      {showImport && (
        <div style={{ marginTop: 16 }}>
          <p style={s.hint}>Cole o conteúdo do arquivo JSON do tema VS Code abaixo:</p>
          <textarea
            style={s.textarea}
            rows={10}
            value={vscodeJson}
            onChange={e => setVscodeJson(e.target.value)}
            placeholder='{ "name": "My Theme", "colors": { "editor.background": "#1e1e1e", ... } }'
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={s.btn} onClick={handlePreview}>👁️ Pré-visualizar</button>
            {importPreview && <button style={s.accentBtn} onClick={handleApplyImport}>✅ Aplicar</button>}
          </div>
          {importError && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{importError}</p>}
          {importPreview && (
            <div style={{ marginTop: 12 }}>
              <p style={s.hint}>Pré-visualização de "{importPreview.displayName}":</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(importPreview.colors).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, background: v, border: '1px solid #555' }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.replace('--', '')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── LLM Tab ───────────────────────────────────────────────────────────────────

function LlmTab() {
  const [primaryUrl, setPrimaryUrl] = useState('http://localhost:11434')
  const [primaryModel, setPrimaryModel] = useState('llama3')
  const [fallbackEnabled, setFallbackEnabled] = useState(false)
  const [fallbackUrl, setFallbackUrl] = useState('')
  const [fallbackModel, setFallbackModel] = useState('')
  const [primaryStatus, setPrimaryStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [fallbackStatus, setFallbackStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.get<Record<string, string>>('/admin/settings').then(r => {
      const d = r.data
      if (d['llm.primary.url']) setPrimaryUrl(d['llm.primary.url'])
      if (d['llm.primary.model']) setPrimaryModel(d['llm.primary.model'])
      if (d['llm.fallback.enabled']) setFallbackEnabled(d['llm.fallback.enabled'] === 'true')
      if (d['llm.fallback.url']) setFallbackUrl(d['llm.fallback.url'])
      if (d['llm.fallback.model']) setFallbackModel(d['llm.fallback.model'])
    }).catch(() => {})
  }, [])

  const testConnection = async (url: string, setter: (s: 'idle' | 'ok' | 'error') => void) => {
    setter('idle')
    try {
      const resp = await fetch(`${url}/api/tags`)
      setter(resp.ok ? 'ok' : 'error')
    } catch {
      setter('error')
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/admin/settings', {
        settings: {
          'llm.primary.url': primaryUrl,
          'llm.primary.model': primaryModel,
          'llm.fallback.enabled': String(fallbackEnabled),
          'llm.fallback.url': fallbackUrl,
          'llm.fallback.model': fallbackModel,
        },
      })
      setMsg('Configurações salvas!')
    } catch {
      setMsg('Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      {msg && <div style={s.toast}>{msg} <button style={s.toastClose} onClick={() => setMsg('')}>✕</button></div>}
      <h3 style={s.sectionTitle}>Servidor Principal</h3>
      <label style={s.label}>URL</label>
      <input style={s.input} value={primaryUrl} onChange={e => setPrimaryUrl(e.target.value)} placeholder="http://localhost:11434" />
      <label style={s.label}>Modelo</label>
      <input style={s.input} value={primaryModel} onChange={e => setPrimaryModel(e.target.value)} placeholder="llama3" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button style={s.btn} onClick={() => testConnection(primaryUrl, setPrimaryStatus)}>🔌 Testar conexão</button>
        {primaryStatus === 'ok' && <span style={{ color: 'var(--success)' }}>✅ Conectado</span>}
        {primaryStatus === 'error' && <span style={{ color: 'var(--danger)' }}>❌ Erro</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px' }}>
        <label style={{ ...s.label, margin: 0 }}>Habilitar fallback</label>
        <input type="checkbox" checked={fallbackEnabled} onChange={e => setFallbackEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
      </div>

      {fallbackEnabled && (
        <div>
          <h3 style={s.sectionTitle}>Servidor Fallback</h3>
          <label style={s.label}>URL</label>
          <input style={s.input} value={fallbackUrl} onChange={e => setFallbackUrl(e.target.value)} placeholder="http://localhost:11435" />
          <label style={s.label}>Modelo</label>
          <input style={s.input} value={fallbackModel} onChange={e => setFallbackModel(e.target.value)} placeholder="llama3" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <button style={s.btn} onClick={() => testConnection(fallbackUrl, setFallbackStatus)}>🔌 Testar conexão</button>
            {fallbackStatus === 'ok' && <span style={{ color: 'var(--success)' }}>✅ Conectado</span>}
            {fallbackStatus === 'error' && <span style={{ color: 'var(--danger)' }}>❌ Erro</span>}
          </div>
        </div>
      )}

      <button style={s.accentBtn} onClick={save} disabled={saving}>{saving ? 'Salvando...' : '💾 Salvar'}</button>
    </div>
  )
}

// ── Paperless Tab ─────────────────────────────────────────────────────────────

function PaperlessTab() {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [globalTagId, setGlobalTagId] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [tags, setTags] = useState<{ id: number; name: string }[]>([])
  const [loadingTags, setLoadingTags] = useState(false)

  useEffect(() => {
    api.get<Record<string, string>>('/admin/settings').then(r => {
      const d = r.data
      if (d['paperless.url']) setUrl(d['paperless.url'])
      if (d['paperless.token']) setToken(d['paperless.token'])
      if (d['paperless.globalTagId']) setGlobalTagId(d['paperless.globalTagId'])
    }).catch(() => {})
  }, [])

  const testConnection = async () => {
    setStatus('idle')
    try {
      // Usa o backend como proxy para evitar bloqueio CORS do browser
      const r = await api.post<{ ok: boolean; statusCode?: number; error?: string }>(
        '/paperless/test',
        { url, token }
      )
      setStatus(r.data.ok ? 'ok' : 'error')
    } catch {
      setStatus('error')
    }
  }

  const loadTags = async () => {
    setLoadingTags(true)
    try {
      const r = await api.get<{ results: { id: number; name: string }[] }>('/paperless/tags')
      setTags(r.data.results ?? [])
    } catch {
      setMsg('Erro ao carregar tags do Paperless.')
    } finally {
      setLoadingTags(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/admin/settings', {
        settings: {
          'paperless.url': url,
          'paperless.token': token,
          'paperless.globalTagId': globalTagId,
        },
      })
      setMsg('Configurações salvas!')
    } catch {
      setMsg('Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      {msg && <div style={s.toast}>{msg} <button style={s.toastClose} onClick={() => setMsg('')}>✕</button></div>}

      <h3 style={s.sectionTitle}>Conexão com Paperless-ng</h3>
      <label style={s.label}>URL do servidor</label>
      <input style={s.input} value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:8000" />
      <label style={s.label}>Token de autenticação</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          style={{ ...s.input, flex: 1, marginBottom: 0 }}
          type={showToken ? 'text' : 'password'}
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="Token de API"
        />
        <button style={s.btn} onClick={() => setShowToken(v => !v)}>{showToken ? '🙈' : '👁️'}</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button style={s.btn} onClick={testConnection}>🔌 Testar conexão</button>
        {status === 'ok' && <span style={{ color: 'var(--success)' }}>✅ Conectado</span>}
        {status === 'error' && <span style={{ color: 'var(--danger)' }}>❌ Erro</span>}
      </div>

      <h3 style={s.sectionTitle}>Tag Global</h3>
      <p style={s.hint}>
        Esta tag é usada como base em todas as consultas. Projetos sem tag própria consultam apenas esta tag.
        Informe o <strong>ID numérico</strong> da tag no Paperless-ng.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={s.label}>ID da Tag Global</label>
          <input
            style={{ ...s.input, marginBottom: 0 }}
            type="number"
            value={globalTagId}
            onChange={e => setGlobalTagId(e.target.value)}
            placeholder="ex: 5"
          />
        </div>
        {url && token && (
          <button style={s.btn} onClick={loadTags} disabled={loadingTags}>
            {loadingTags ? '⏳' : '🏷️ Carregar tags'}
          </button>
        )}
      </div>

      {tags.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <p style={{ ...s.hint, marginBottom: 8 }}>Clique em uma tag para usar como global:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map(t => (
              <button
                key={t.id}
                style={{
                  background: globalTagId === String(t.id) ? 'var(--accent)' : 'var(--bg-card)',
                  color: globalTagId === String(t.id) ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 20, padding: '3px 10px', cursor: 'pointer', fontSize: 12,
                }}
                onClick={() => setGlobalTagId(String(t.id))}
              >
                #{t.id} {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <button style={s.accentBtn} onClick={save} disabled={saving}>{saving ? 'Salvando...' : '💾 Salvar'}</button>

      <div style={{ marginTop: 28, padding: '12px 14px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--text-secondary)' }}>📌 Tags por Projeto</strong>
        <p style={{ marginTop: 6, lineHeight: 1.6 }}>
          Para associar uma tag específica a um projeto, acesse a aba <strong>🗂️ Projetos</strong> e edite a coluna <em>Tag Paperless</em>.
        </p>
        <p style={{ marginTop: 4, lineHeight: 1.6 }}>
          <strong>Lógica de consulta:</strong><br />
          • Projeto <em>sem</em> tag → consulta apenas Tag Global<br />
          • Projeto <em>com</em> tag → (1) Tag Projeto + Tag Global → (2) Só Tag Projeto → (3) Só Tag Global
        </p>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    padding: '2rem',
    color: 'var(--text-primary)',
    background: 'var(--bg-primary)',
    flex: 1,
    overflowY: 'auto' as const,
  },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 20, color: 'var(--text-primary)' },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 24 },
  tab: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    padding: '8px 16px', cursor: 'pointer', fontSize: 13, borderRadius: '6px 6px 0 0',
    borderBottom: '2px solid transparent',
  },
  tabActive: {
    color: 'var(--accent)',
    borderBottom: '2px solid var(--accent)',
    background: 'var(--bg-elevated)',
  },
  content: { },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '10px 12px', color: 'var(--text-secondary)' },

  select: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 6, padding: '4px 8px', fontSize: 12,
  },
  dangerBtn: {
    background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
  },

  sectionTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, marginTop: 8 },
  hint: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 },

  label: { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 },
  input: {
    display: 'block', width: '100%', boxSizing: 'border-box',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 6, padding: '8px 10px', fontSize: 13, marginBottom: 10,
  },
  textarea: {
    display: 'block', width: '100%', boxSizing: 'border-box',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 6, padding: '8px 10px', fontSize: 12,
    fontFamily: 'monospace', resize: 'vertical',
  },

  btn: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', borderRadius: 6, padding: '7px 14px',
    cursor: 'pointer', fontSize: 13,
  },
  accentBtn: {
    background: 'var(--accent)', border: 'none', color: '#fff',
    borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  },

  themeCard: {
    background: 'var(--bg-card)', borderRadius: 10, padding: 12,
    cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    transition: 'border 0.15s',
  },

  toast: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 8, padding: '10px 16px',
    marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: 13,
  },
  toastClose: {
    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14,
  },
}
