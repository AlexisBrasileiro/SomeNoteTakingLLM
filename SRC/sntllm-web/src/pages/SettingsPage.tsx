import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme, BUILTIN_THEMES, type ThemeDefinition } from '../context/ThemeContext'
import { useI18n, useT } from '../context/I18nContext'
import { LANGS } from '../i18n'
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

type Tab = 'users' | 'projects' | 'theme' | 'llm' | 'paperless' | 'auth' | 'language'

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('users')
  const t = useT()

  if (user?.role !== 'Admin') {
    navigate('/', { replace: true })
    return null
  }

  return (
    <AppLayout>
      <div style={s.page}>
        <h1 style={s.title}>⚙️ {t('settings.title')}</h1>
        <div style={s.tabs}>
          {(['users', 'projects', 'theme', 'llm', 'paperless', 'auth', 'language'] as Tab[]).map(tb => (
            <button
              key={tb}
              style={{ ...s.tab, ...(tab === tb ? s.tabActive : {}) }}
              onClick={() => setTab(tb)}
            >
              {tabLabel(tb, t)}
            </button>
          ))}
        </div>
        <div style={s.content}>
          {tab === 'users'     && <UsersTab />}
          {tab === 'projects'  && <ProjectsTab />}
          {tab === 'theme'     && <ThemeTab />}
          {tab === 'llm'       && <LlmTab />}
          {tab === 'paperless' && <PaperlessTab />}
          {tab === 'auth'      && <AuthTab />}
          {tab === 'language'  && <LanguageTab />}
        </div>
      </div>
    </AppLayout>
  )
}

function tabLabel(tb: Tab, t: (k: string) => string) {
  const map: Record<Tab, string> = {
    users: `👤 ${t('settings.tabs.users')}`,
    projects: `🗂️ ${t('settings.tabs.projects')}`,
    theme: `🎨 ${t('settings.tabs.theme')}`,
    llm: `🤖 ${t('settings.tabs.llm')}`,
    paperless: `📄 ${t('settings.tabs.paperless')}`,
    auth: `🔐 ${t('settings.tabs.auth')}`,
    language: `🌐 ${t('settings.tabs.language')}`,
  }
  return map[tb]
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ userName: '', email: '', password: '', role: 'Reader' })
  const [creating, setCreating] = useState(false)
  const t = useT()

  const load = () => {
    setLoading(true)
    api.get<UserSummary[]>('/admin/users').then(r => { setUsers(r.data); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const createUser = async () => {
    if (!createForm.userName || !createForm.email || !createForm.password) return
    setCreating(true)
    try {
      await api.post('/admin/users', createForm)
      setMsg(t('settings.users.created'))
      setShowCreate(false)
      setCreateForm({ userName: '', email: '', password: '', role: 'Reader' })
      load()
    } catch {
      setMsg(t('settings.users.createError'))
    } finally {
      setCreating(false)
    }
  }

  const changeRole = async (id: string, role: string) => {
    try {
      await api.put(`/admin/users/${id}/role`, { role })
      setMsg(t('settings.users.roleUpdated'))
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setMsg(err.response?.data?.message ?? t('settings.users.roleError'))
    }
  }

  const deleteUser = async (id: string, name: string) => {
    if (!window.confirm(t('settings.users.deleteConfirm', { name }))) return
    try {
      await api.delete(`/admin/users/${id}`)
      setMsg(t('settings.users.deleted'))
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setMsg(err.response?.data?.message ?? t('settings.users.deleteError'))
    }
  }

  return (
    <div>
      {msg && <div style={s.toast}>{msg} <button style={s.toastClose} onClick={() => setMsg('')}>✕</button></div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button style={s.primaryBtn} onClick={() => setShowCreate(v => !v)}>
          {showCreate ? t('common.cancel') : `+ ${t('settings.users.createBtn')}`}
        </button>
      </div>
      {showCreate && (
        <div style={s.createForm}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>{t('settings.users.createTitle')}</h3>
          <div style={s.formRow}>
            <label style={s.formLabel}>{t('settings.users.username')}</label>
            <input style={s.formInput} value={createForm.userName} onChange={e => setCreateForm(f => ({ ...f, userName: e.target.value }))} />
          </div>
          <div style={s.formRow}>
            <label style={s.formLabel}>{t('login.email')}</label>
            <input style={s.formInput} type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div style={s.formRow}>
            <label style={s.formLabel}>{t('login.password')}</label>
            <input style={s.formInput} type="password" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <div style={s.formRow}>
            <label style={s.formLabel}>Role</label>
            <select style={s.select} value={createForm.role} onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}>
              {['Admin', 'Manager', 'Contributor', 'Reader'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button style={s.primaryBtn} disabled={creating} onClick={createUser}>
            {creating ? t('common.saving') : t('settings.users.createBtn')}
          </button>
        </div>
      )}
      {loading ? <p style={s.hint}>{t('common.loading')}</p> : (
        <table style={s.table}>
          <thead>
            <tr>
              {[t('settings.users.username'), 'Email', 'Role', t('settings.users.createdAt'), t('common.actions')].map(h => <th key={h} style={s.th}>{h}</th>)}
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
                  <button style={s.dangerBtn} onClick={() => deleteUser(u.id, u.userName)}>{t('common.delete')}</button>
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
  const t = useT()

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
      {loading ? <p style={s.hint}>{t('common.loading')}</p> : (
        <table style={s.table}>
          <thead>
            <tr>
              {[t('settings.projects.name'), t('settings.projects.owner'), t('settings.users.createdAt'), t('settings.projects.archived'), t('settings.projects.paperlessTag')].map(h => <th key={h} style={s.th}>{h}</th>)}
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
  const t = useT()

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
    setMsg(t('settings.theme.importApplied'))
    setShowImport(false)
    setImportPreview(null)
    setVscodeJson('')
  }

  return (
    <div>
      {msg && <div style={s.toast}>{msg} <button style={s.toastClose} onClick={() => setMsg('')}>✕</button></div>}
      <h3 style={s.sectionTitle}>{t('settings.theme.builtIn')}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        {BUILTIN_THEMES.map(theme => {
          const isActive = currentTheme?.name === theme.name
          return (
            <button
              key={theme.name}
              onClick={() => { applyBuiltin(theme.name); setMsg(t('settings.theme.applied', { name: theme.displayName })) }}
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
        📂 {t('settings.theme.importVscode')}
      </button>

      {showImport && (
        <div style={{ marginTop: 16 }}>
          <p style={s.hint}>{t('settings.theme.importHint')}</p>
          <textarea
            style={s.textarea}
            rows={10}
            value={vscodeJson}
            onChange={e => setVscodeJson(e.target.value)}
            placeholder='{ "name": "My Theme", "colors": { "editor.background": "#1e1e1e", ... } }'
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={s.btn} onClick={handlePreview}>👁️ {t('settings.theme.preview')}</button>
            {importPreview && <button style={s.accentBtn} onClick={handleApplyImport}>✅ {t('settings.theme.apply')}</button>}
          </div>
          {importError && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{importError}</p>}
          {importPreview && (
            <div style={{ marginTop: 12 }}>
              <p style={s.hint}>{t('settings.theme.previewOf', { name: importPreview.displayName })}</p>
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
  const t = useT()

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
      setMsg(t('common.saved'))
    } catch {
      setMsg(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      {msg && <div style={s.toast}>{msg} <button style={s.toastClose} onClick={() => setMsg('')}>✕</button></div>}
      <h3 style={s.sectionTitle}>{t('settings.llm.primaryServer')}</h3>
      <label style={s.label}>URL</label>
      <input style={s.input} value={primaryUrl} onChange={e => setPrimaryUrl(e.target.value)} placeholder="http://localhost:11434" />
      <label style={s.label}>{t('settings.llm.model')}</label>
      <input style={s.input} value={primaryModel} onChange={e => setPrimaryModel(e.target.value)} placeholder="llama3" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button style={s.btn} onClick={() => testConnection(primaryUrl, setPrimaryStatus)}>🔌 {t('settings.llm.testConn')}</button>
        {primaryStatus === 'ok' && <span style={{ color: 'var(--success)' }}>✅ {t('settings.llm.connected')}</span>}
        {primaryStatus === 'error' && <span style={{ color: 'var(--danger)' }}>❌ {t('common.error')}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px' }}>
        <label style={{ ...s.label, margin: 0 }}>{t('settings.llm.enableFallback')}</label>
        <input type="checkbox" checked={fallbackEnabled} onChange={e => setFallbackEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
      </div>

      {fallbackEnabled && (
        <div>
          <h3 style={s.sectionTitle}>{t('settings.llm.fallbackServer')}</h3>
          <label style={s.label}>URL</label>
          <input style={s.input} value={fallbackUrl} onChange={e => setFallbackUrl(e.target.value)} placeholder="http://localhost:11435" />
          <label style={s.label}>{t('settings.llm.model')}</label>
          <input style={s.input} value={fallbackModel} onChange={e => setFallbackModel(e.target.value)} placeholder="llama3" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <button style={s.btn} onClick={() => testConnection(fallbackUrl, setFallbackStatus)}>🔌 {t('settings.llm.testConn')}</button>
            {fallbackStatus === 'ok' && <span style={{ color: 'var(--success)' }}>✅ {t('settings.llm.connected')}</span>}
            {fallbackStatus === 'error' && <span style={{ color: 'var(--danger)' }}>❌ {t('common.error')}</span>}
          </div>
        </div>
      )}

      <button style={s.accentBtn} onClick={save} disabled={saving}>{saving ? t('common.saving') : `💾 ${t('common.save')}`}</button>
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
  const t = useT()

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
      setMsg(t('settings.paperless.loadTagsError'))
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
      setMsg(t('common.saved'))
    } catch {
      setMsg(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      {msg && <div style={s.toast}>{msg} <button style={s.toastClose} onClick={() => setMsg('')}>✕</button></div>}

      <h3 style={s.sectionTitle}>{t('settings.paperless.connTitle')}</h3>
      <label style={s.label}>{t('settings.paperless.serverUrl')}</label>
      <input style={s.input} value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:8000" />
      <label style={s.label}>{t('settings.paperless.token')}</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          style={{ ...s.input, flex: 1, marginBottom: 0 }}
          type={showToken ? 'text' : 'password'}
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder={t('settings.paperless.tokenPh')}
        />
        <button style={s.btn} onClick={() => setShowToken(v => !v)}>{showToken ? '🙈' : '👁️'}</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button style={s.btn} onClick={testConnection}>🔌 {t('settings.llm.testConn')}</button>
        {status === 'ok' && <span style={{ color: 'var(--success)' }}>✅ {t('settings.llm.connected')}</span>}
        {status === 'error' && <span style={{ color: 'var(--danger)' }}>❌ {t('common.error')}</span>}
      </div>

      <h3 style={s.sectionTitle}>{t('settings.paperless.globalTag')}</h3>
      <p style={s.hint}>{t('settings.paperless.globalTagHint')}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={s.label}>{t('settings.paperless.globalTagId')}</label>
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
            {loadingTags ? '⏳' : `🏷️ ${t('settings.paperless.loadTags')}`}
          </button>
        )}
      </div>

      {tags.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <p style={{ ...s.hint, marginBottom: 8 }}>{t('settings.paperless.clickTag')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map(tg => (
              <button
                key={tg.id}
                style={{
                  background: globalTagId === String(tg.id) ? 'var(--accent)' : 'var(--bg-card)',
                  color: globalTagId === String(tg.id) ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 20, padding: '3px 10px', cursor: 'pointer', fontSize: 12,
                }}
                onClick={() => setGlobalTagId(String(tg.id))}
              >
                #{tg.id} {tg.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <button style={s.accentBtn} onClick={save} disabled={saving}>{saving ? t('common.saving') : `💾 ${t('common.save')}`}</button>
    </div>
  )
}

// ── Auth Tab ──────────────────────────────────────────────────────────────────

function AuthTab() {
  const [enabled, setEnabled] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [tokenUrl, setTokenUrl] = useState('')
  const [userInfoUrl, setUserInfoUrl] = useState('')
  const [scope, setScope] = useState('openid profile email')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const t = useT()

  useEffect(() => {
    api.get<Record<string, string>>('/admin/settings').then(r => {
      const d = r.data
      if (d['auth.oidc.enabled']) setEnabled(d['auth.oidc.enabled'] === 'true')
      if (d['auth.oidc.clientId']) setClientId(d['auth.oidc.clientId'])
      if (d['auth.oidc.clientSecret']) setClientSecret(d['auth.oidc.clientSecret'])
      if (d['auth.oidc.authorizationUrl']) setAuthUrl(d['auth.oidc.authorizationUrl'])
      if (d['auth.oidc.tokenUrl']) setTokenUrl(d['auth.oidc.tokenUrl'])
      if (d['auth.oidc.userInfoUrl']) setUserInfoUrl(d['auth.oidc.userInfoUrl'])
      if (d['auth.oidc.scope']) setScope(d['auth.oidc.scope'])
      if (d['auth.oidc.callbackUrl']) setCallbackUrl(d['auth.oidc.callbackUrl'])
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/admin/settings', {
        settings: {
          'auth.oidc.enabled': String(enabled),
          'auth.oidc.clientId': clientId,
          'auth.oidc.clientSecret': clientSecret,
          'auth.oidc.authorizationUrl': authUrl,
          'auth.oidc.tokenUrl': tokenUrl,
          'auth.oidc.userInfoUrl': userInfoUrl,
          'auth.oidc.scope': scope,
          'auth.oidc.callbackUrl': callbackUrl,
        },
      })
      setMsg(t('common.saved'))
    } catch {
      setMsg(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      {msg && <div style={s.toast}>{msg} <button style={s.toastClose} onClick={() => setMsg('')}>✕</button></div>}
      <h3 style={s.sectionTitle}>{t('settings.auth.oidcTitle')}</h3>
      <p style={s.hint}>{t('settings.auth.oidcHint')}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <label style={{ ...s.label, margin: 0 }}>{t('settings.auth.enableOidc')}</label>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
      </div>
      {enabled && (
        <>
          <label style={s.label}>Client ID</label>
          <input style={s.input} value={clientId} onChange={e => setClientId(e.target.value)} placeholder="your-client-id" />
          <label style={s.label}>Client Secret</label>
          <input style={s.input} type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="••••••••" />
          <label style={s.label}>{t('settings.auth.authUrl')}</label>
          <input style={s.input} value={authUrl} onChange={e => setAuthUrl(e.target.value)} placeholder="https://idp.example.com/oauth2/authorize" />
          <label style={s.label}>{t('settings.auth.tokenUrl')}</label>
          <input style={s.input} value={tokenUrl} onChange={e => setTokenUrl(e.target.value)} placeholder="https://idp.example.com/oauth2/token" />
          <label style={s.label}>{t('settings.auth.userInfoUrl')}</label>
          <input style={s.input} value={userInfoUrl} onChange={e => setUserInfoUrl(e.target.value)} placeholder="https://idp.example.com/oauth2/userinfo" />
          <label style={s.label}>Scope</label>
          <input style={s.input} value={scope} onChange={e => setScope(e.target.value)} placeholder="openid profile email" />
          <label style={s.label}>{t('settings.auth.callbackUrl')}</label>
          <input style={s.input} value={callbackUrl} onChange={e => setCallbackUrl(e.target.value)} placeholder="http://localhost:3000/auth/callback" />
        </>
      )}
      <button style={s.accentBtn} onClick={save} disabled={saving}>{saving ? t('common.saving') : `💾 ${t('common.save')}`}</button>
    </div>
  )
}

// ── Language Tab ──────────────────────────────────────────────────────────────

function LanguageTab() {
  const { lang, setLang } = useI18n()
  const t = useT()

  return (
    <div style={{ maxWidth: 400 }}>
      <h3 style={s.sectionTitle}>{t('settings.language.title')}</h3>
      <p style={s.hint}>{t('settings.language.hint')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        {LANGS.map(l => (
          <button
            key={l.code}
            onClick={() => setLang(l.code)}
            style={{
              ...s.btn,
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', fontSize: 14,
              background: lang === l.code ? 'var(--bg-elevated)' : 'none',
              border: lang === l.code ? '1px solid var(--accent)' : '1px solid var(--border)',
              color: lang === l.code ? 'var(--accent)' : 'var(--text-secondary)',
              fontWeight: lang === l.code ? 700 : 400,
            }}
          >
            <span style={{ fontSize: 22 }}>{l.flag}</span>
            <span>{l.label}</span>
            {lang === l.code && <span style={{ marginLeft: 'auto' }}>✓</span>}
          </button>
        ))}
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

  primaryBtn: {
    background: 'var(--accent)', border: 'none', color: '#fff',
    borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  },
  createForm: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '16px 20px', marginBottom: 20,
  },
  formRow: { marginBottom: 10 },
  formLabel: { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 },
  formInput: {
    display: 'block', width: '100%', boxSizing: 'border-box',
    background: 'var(--bg-primary)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 6, padding: '7px 10px', fontSize: 13,
  },
}
