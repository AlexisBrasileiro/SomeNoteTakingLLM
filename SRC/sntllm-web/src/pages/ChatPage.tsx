import { useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import MarkdownPreview from '@uiw/react-markdown-preview'
import api from '../api/client'
import AppLayout from '../components/AppLayout'
import type { ChatMessage, ChatReference, Note, Project } from '../types'

interface ChatDetail {
  id: string
  title: string
  projectId?: string
  createdAt: string
  messages: ChatMessage[]
}

interface PaperlessTag { id: number; name: string }
interface PaperlessDoc { id: number; title: string; original_file_name?: string }
interface DocumentQueryResult { strategy: string; strategyLabel: string; documents: PaperlessDoc[] }

type SendStatus = 'idle' | 'connecting' | 'waiting' | 'error'

// ── Typing dots ───────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <span className="chat-dot" />
      <span className="chat-dot" />
      <span className="chat-dot" />
    </span>
  )
}

// ── Status indicator ─────────────────────────────────────────────────────────

function StatusBar({ status, errorMsg }: { status: SendStatus; errorMsg: string | null }) {
  if (status === 'idle' && !errorMsg) return null

  const map: Record<SendStatus, { icon: string; label: string; color: string }> = {
    idle:       { icon: '', label: '', color: '' },
    connecting: { icon: '🔌', label: 'Conectando ao Ollama...', color: '#fbbf24' },
    waiting:    { icon: '🧠', label: 'Aguardando resposta...', color: '#818cf8' },
    error:      { icon: '⚠️', label: errorMsg ?? 'Erro desconhecido', color: '#f87171' },
  }

  const { icon, label, color } = map[status]
  const pulse = status !== 'idle' && status !== 'error'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 16px', background: 'rgba(0,0,0,0.3)',
      borderBottom: `1px solid ${color}33`, flexShrink: 0,
    }}>
      <span className={pulse ? 'status-pulse' : undefined} style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 12, color, fontWeight: 600 }}>{label}</span>
      {pulse && <TypingDots />}
    </div>
  )
}

// ── Reference Modal ───────────────────────────────────────────────────────────

function RefModal({ onClose, onAdd, alreadyAdded }: {
  onClose: () => void
  onAdd: (ref: ChatReference) => void
  alreadyAdded: ChatReference[]
}) {
  const [tab, setTab] = useState<'notes' | 'tags' | 'docs'>('notes')
  const [notes, setNotes] = useState<Note[]>([])
  const [tags, setTags] = useState<PaperlessTag[]>([])
  const [docs, setDocs] = useState<PaperlessDoc[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    if (tab === 'notes') {
      api.get<Note[]>('/notes').then(r => setNotes(r.data)).catch(() => {}).finally(() => setLoading(false))
    } else if (tab === 'tags') {
      api.get<{ count: number; results: PaperlessTag[] }>('/paperless/tags')
        .then(r => setTags(r.data.results ?? [])).catch(() => setTags([])).finally(() => setLoading(false))
    } else {
      api.get<DocumentQueryResult[]>('/paperless/documents')
        .then(r => {
          const all = r.data.flatMap(qr => qr.documents)
          setDocs(Array.from(new Map(all.map(d => [d.id, d])).values()))
        }).catch(() => setDocs([])).finally(() => setLoading(false))
    }
  }, [tab])

  const isAdded = (type: ChatReference['type'], id: string) =>
    alreadyAdded.some(r => r.type === type && r.id === id)

  const filteredNotes = notes.filter(n => (n.title ?? 'Sem título').toLowerCase().includes(search.toLowerCase()))
  const filteredTags  = tags.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
  const filteredDocs  = docs.filter(d => (d.title ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={ms.modal} onClick={e => e.stopPropagation()}>
        <div style={ms.header}>
          <span style={ms.title}>Adicionar referência</span>
          <button style={ms.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={ms.tabs}>
          {(['notes', 'tags', 'docs'] as const).map(t => (
            <button key={t} style={{ ...ms.tabBtn, ...(tab === t ? ms.tabActive : {}) }}
              onClick={() => { setTab(t); setSearch('') }}>
              {t === 'notes' ? '📝 Notas' : t === 'tags' ? '🏷️ Tags' : '📄 Documentos'}
            </button>
          ))}
        </div>
        <input style={ms.search} placeholder="Buscar..." value={search}
          onChange={e => setSearch(e.target.value)} />
        <div style={ms.list}>
          {loading && <div style={ms.hint}>Carregando...</div>}
          {!loading && tab === 'notes' && filteredNotes.map(n => {
            const added = isAdded('note', n.id)
            return (
              <button key={n.id} style={{ ...ms.item, ...(added ? ms.itemAdded : {}) }}
                onClick={() => !added && onAdd({ type: 'note', id: n.id, title: n.title ?? 'Sem título' })}
                disabled={added}>
                <span>📝 {n.title ?? 'Sem título'}</span>
                {added && <span style={ms.checkmark}>✓</span>}
              </button>
            )
          })}
          {!loading && tab === 'tags' && filteredTags.map(t => {
            const added = isAdded('paperless_tag', String(t.id))
            return (
              <button key={t.id} style={{ ...ms.item, ...(added ? ms.itemAdded : {}) }}
                onClick={() => !added && onAdd({ type: 'paperless_tag', id: String(t.id), title: t.name })}
                disabled={added}>
                <span>🏷️ {t.name}</span>
                {added && <span style={ms.checkmark}>✓</span>}
              </button>
            )
          })}
          {!loading && tab === 'docs' && filteredDocs.map(d => {
            const added = isAdded('paperless_document', String(d.id))
            return (
              <button key={d.id} style={{ ...ms.item, ...(added ? ms.itemAdded : {}) }}
                onClick={() => !added && onAdd({ type: 'paperless_document', id: String(d.id), title: d.title ?? d.original_file_name ?? `Documento #${d.id}` })}
                disabled={added}>
                <span>📄 {d.title ?? d.original_file_name ?? `Documento #${d.id}`}</span>
                {added && <span style={ms.checkmark}>✓</span>}
              </button>
            )
          })}
          {!loading && tab === 'notes' && filteredNotes.length === 0 && <div style={ms.hint}>Nenhuma nota encontrada.</div>}
          {!loading && tab === 'tags'  && filteredTags.length === 0  && <div style={ms.hint}>Nenhuma tag encontrada.</div>}
          {!loading && tab === 'docs'  && filteredDocs.length === 0  && <div style={ms.hint}>Nenhum documento encontrado.</div>}
        </div>
      </div>
    </div>
  )
}

// ── References Panel (right sidebar) ─────────────────────────────────────────

function refIcon(type: ChatReference['type']) {
  if (type === 'note') return '📝'
  if (type === 'paperless_tag') return '🏷️'
  return '📄'
}

function RefsPanel({ messages, open, onToggle }: {
  messages: ChatMessage[]
  open: boolean
  onToggle: () => void
}) {
  // Collect all unique refs from ALL messages
  const allRefs = useMemo(() => {
    const seen = new Set<string>()
    const result: (ChatReference & { msgCount: number })[] = []
    const countMap = new Map<string, number>()

    for (const msg of messages) {
      if (!msg.references) continue
      for (const r of msg.references) {
        const key = `${r.type}:${r.id}`
        countMap.set(key, (countMap.get(key) ?? 0) + 1)
        if (!seen.has(key)) {
          seen.add(key)
          result.push({ ...r, msgCount: 0 })
        }
      }
    }
    return result.map(r => ({ ...r, msgCount: countMap.get(`${r.type}:${r.id}`) ?? 1 }))
  }, [messages])

  const notes = allRefs.filter(r => r.type === 'note')
  const tags  = allRefs.filter(r => r.type === 'paperless_tag')
  const docs  = allRefs.filter(r => r.type === 'paperless_document')

  return (
    <div style={{ ...rp.panel, width: open ? 260 : 36 }}>
      {/* Toggle tab */}
      <button style={rp.toggleBtn} onClick={onToggle} title={open ? 'Fechar painel' : 'Ver referências'}>
        {open ? '›' : '‹'}
        {!open && allRefs.length > 0 && (
          <span style={rp.badgeMini}>{allRefs.length}</span>
        )}
      </button>

      {open && (
        <div style={rp.content}>
          <div style={rp.header}>
            <span style={rp.title}>📎 Referências</span>
            <span style={rp.count}>{allRefs.length}</span>
          </div>

          {allRefs.length === 0 && (
            <div style={rp.empty}>Nenhuma referência usada ainda.</div>
          )}

          {notes.length > 0 && (
            <div style={rp.group}>
              <div style={rp.groupLabel}>📝 Notas ({notes.length})</div>
              {notes.map(r => (
                <div key={`${r.type}:${r.id}`} style={rp.item}>
                  <span style={rp.itemTitle}>{r.title}</span>
                  <span style={rp.itemCount}>×{r.msgCount}</span>
                </div>
              ))}
            </div>
          )}

          {tags.length > 0 && (
            <div style={rp.group}>
              <div style={rp.groupLabel}>🏷️ Tags Paperless ({tags.length})</div>
              {tags.map(r => (
                <div key={`${r.type}:${r.id}`} style={rp.item}>
                  <span style={rp.itemTitle}>{r.title}</span>
                  <span style={rp.itemCount}>×{r.msgCount}</span>
                </div>
              ))}
            </div>
          )}

          {docs.length > 0 && (
            <div style={rp.group}>
              <div style={rp.groupLabel}>📄 Documentos ({docs.length})</div>
              {docs.map(r => (
                <div key={`${r.type}:${r.id}`} style={rp.item}>
                  <span style={rp.itemTitle}>{r.title}</span>
                  <span style={rp.itemCount}>×{r.msgCount}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── ChatPage ──────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const navigate = useNavigate()

  const [newTitle, setNewTitle] = useState('')
  const [newProjectId, setNewProjectId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [chat, setChat] = useState<ChatDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [input, setInput] = useState('')
  const [selectedRefs, setSelectedRefs] = useState<ChatReference[]>([])
  const [showRefModal, setShowRefModal] = useState(false)
  const [sendStatus, setSendStatus] = useState<SendStatus>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [refsPanelOpen, setRefsPanelOpen] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isNew) {
      api.get<Project[]>('/projects').then(r => setProjects(r.data)).catch(() => {})
      return
    }
    if (!id) return
    setLoading(true)
    setError(null)
    api.get<ChatDetail>(`/chats/${id}`)
      .then(r => { setChat(r.data); setSendStatus('idle'); setSendError(null) })
      .catch(() => setError('Erro ao carregar chat.'))
      .finally(() => setLoading(false))
  }, [id, isNew])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat?.messages.length])

  async function handleCreate() {
    if (!newTitle.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const r = await api.post<ChatDetail>('/chats', { title: newTitle, projectId: newProjectId || null })
      navigate(`/chat/${r.data.id}`, { replace: true })
    } catch {
      setCreateError('Erro ao criar chat.')
    } finally {
      setCreating(false)
    }
  }

  async function handleSend() {
    if (!input.trim() || !id || isNew || sendStatus !== 'idle') return

    const content = input.trim()
    const refs = selectedRefs.length > 0 ? [...selectedRefs] : undefined

    // Optimistic UI
    const tempId = `temp-${Date.now()}`
    const tempUserMsg: ChatMessage = {
      id: tempId,
      role: 'user',
      content,
      references: refs,
      createdAt: new Date().toISOString(),
    }
    setChat(prev => prev ? { ...prev, messages: [...prev.messages, tempUserMsg] } : prev)
    setInput('')
    setSelectedRefs([])
    setSendError(null)
    setSendStatus('connecting')

    // Auto-open refs panel if refs are present
    if (refs && refs.length > 0) setRefsPanelOpen(true)

    // Short delay so user sees "connecting" state before we start waiting
    const connectingTimer = setTimeout(() => {
      setSendStatus('waiting')
    }, 800)

    try {
      const r = await api.post<ChatMessage>(`/chats/${id}/messages`, { content, references: refs })
      clearTimeout(connectingTimer)
      setChat(prev => prev ? { ...prev, messages: [...prev.messages, r.data] } : prev)
      setSendStatus('idle')
    } catch (e: unknown) {
      clearTimeout(connectingTimer)
      const err = e as { response?: { data?: { detail?: string; message?: string; title?: string } } }
      const msg = err.response?.data?.detail
        ?? err.response?.data?.message
        ?? err.response?.data?.title
        ?? 'Erro ao enviar mensagem.'
      setSendError(msg)
      setSendStatus('error')
      // Remove temp message on error so user can retry
      setChat(prev => prev
        ? { ...prev, messages: prev.messages.filter(m => m.id !== tempId) }
        : prev
      )
      setInput(content) // Restore input for retry
      if (refs) setSelectedRefs(refs)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function addRef(ref: ChatReference) {
    setSelectedRefs(prev => [...prev.filter(r => !(r.type === ref.type && r.id === ref.id)), ref])
  }

  function removeRef(ref: ChatReference) {
    setSelectedRefs(prev => prev.filter(r => !(r.type === ref.type && r.id === ref.id)))
  }

  function dismissError() {
    setSendStatus('idle')
    setSendError(null)
  }

  // ── New Chat form ────────────────────────────────────────────────────────────
  if (isNew) {
    return (
      <AppLayout>
        <div style={s.container}>
          <div style={s.toolbar}>
            <button style={s.backBtn} onClick={() => navigate(-1)}>← Voltar</button>
            <span style={s.toolbarTitle}>Novo Chat</span>
          </div>
          <div style={s.newForm}>
            <h2 style={s.newFormTitle}>Criar novo chat</h2>
            <label style={s.label}>Título</label>
            <input style={s.input} placeholder="Nome do chat" value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()} autoFocus />
            <label style={s.label}>Projeto (opcional)</label>
            <select style={s.select} value={newProjectId} onChange={e => setNewProjectId(e.target.value)}>
              <option value="">Nenhum</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {createError && <p style={s.errorMsg}>{createError}</p>}
            <button style={s.createBtn} onClick={handleCreate} disabled={creating || !newTitle.trim()}>
              {creating ? 'Criando...' : 'Criar Chat'}
            </button>
          </div>
        </div>
      </AppLayout>
    )
  }

  const isBusy = sendStatus === 'connecting' || sendStatus === 'waiting'

  // ── Chat view ───────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div style={s.container}>
        {/* Toolbar */}
        <div style={s.toolbar}>
          <button style={s.backBtn} onClick={() => navigate(-1)}>← Voltar</button>
          <span style={s.toolbarTitle}>{chat?.title ?? 'Chat'}</span>
          <button
            style={{ ...s.refsToggleBtn, ...(refsPanelOpen ? s.refsToggleBtnActive : {}) }}
            onClick={() => setRefsPanelOpen(o => !o)}
            title="Referências usadas"
          >
            📎 Referências
            {(chat?.messages ?? []).some(m => m.references && m.references.length > 0) && (
              <span style={s.refsToolbarBadge}>
                {new Set(
                  (chat?.messages ?? []).flatMap(m => m.references ?? []).map(r => `${r.type}:${r.id}`)
                ).size}
              </span>
            )}
          </button>
        </div>

        {/* Ollama status bar */}
        <StatusBar status={sendStatus} errorMsg={sendError} />
        {sendStatus === 'error' && (
          <div style={s.errorBanner}>
            <span>⚠️ {sendError}</span>
            <button style={s.errorDismiss} onClick={dismissError}>✕ Tentar novamente</button>
          </div>
        )}

        {loading && <div style={s.centerMsg}>Carregando...</div>}
        {error   && <div style={s.centerMsg}>{error}</div>}

        {!loading && !error && (
          <div style={s.body}>
            {/* Messages column */}
            <div style={s.messagesCol}>
              <div style={s.messages}>
                {(chat?.messages.length ?? 0) === 0 && (
                  <div style={s.emptyChat}>Envie uma mensagem para começar.</div>
                )}

                {chat?.messages.map(msg => (
                  <div key={msg.id} style={{
                    ...s.msgWrapper,
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    opacity: msg.id.startsWith('temp-') ? 0.7 : 1,
                  }}>
                    <div style={{ ...s.bubble, ...(msg.role === 'user' ? s.userBubble : s.aiBubble) }}>
                      <div style={s.msgRole}>
                        {msg.role === 'user' ? '👤 Você' : '🤖 Assistente'}
                      </div>
                      <div data-color-mode="dark">
                        <MarkdownPreview source={msg.content}
                          style={{ background: 'transparent', color: 'inherit', fontSize: 14 }} />
                      </div>
                      {msg.references && msg.references.length > 0 && (
                        <div style={s.msgRefs}>
                          <span style={s.msgRefsLabel}>📎 Referências:</span>
                          <div style={s.refChips}>
                            {msg.references.map(r => (
                              <span key={`${r.type}:${r.id}`} style={s.refChipReadonly}>
                                {refIcon(r.type)} {r.title}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Thinking bubble */}
                {isBusy && (
                  <div style={{ ...s.msgWrapper, justifyContent: 'flex-start' }}>
                    <div style={{ ...s.bubble, ...s.aiBubble }}>
                      <div style={s.msgRole}>🤖 Assistente</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                        <TypingDots />
                        <span style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
                          {sendStatus === 'connecting' ? 'Conectando ao Ollama...' : 'Pensando...'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div style={s.inputArea}>
                {selectedRefs.length > 0 && (
                  <div style={s.refsBar}>
                    <span style={s.refsBarLabel}>Referências desta mensagem:</span>
                    <div style={s.refChips}>
                      {selectedRefs.map(r => (
                        <span key={`${r.type}:${r.id}`} style={s.refChip}>
                          {refIcon(r.type)} {r.title}
                          <button style={s.refRemoveBtn} onClick={() => removeRef(r)}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div style={s.refRow}>
                  <button style={s.addRefBtn} onClick={() => setShowRefModal(true)} disabled={isBusy}>
                    📎 Adicionar referência
                  </button>
                </div>

                <div style={s.textRow}>
                  <textarea
                    style={s.textarea}
                    placeholder={isBusy ? 'Aguardando resposta...' : 'Digite sua mensagem... (Enter para enviar, Shift+Enter para nova linha)'}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={3}
                    disabled={isBusy}
                  />
                  <button
                    style={{ ...s.sendBtn, ...(isBusy || !input.trim() ? s.sendBtnDisabled : {}) }}
                    onClick={handleSend}
                    disabled={isBusy || !input.trim()}
                    title="Enviar mensagem"
                  >
                    {isBusy ? <TypingDots /> : '➤'}
                  </button>
                </div>
              </div>
            </div>

            {/* References panel */}
            <RefsPanel
              messages={chat?.messages ?? []}
              open={refsPanelOpen}
              onToggle={() => setRefsPanelOpen(o => !o)}
            />
          </div>
        )}
      </div>

      {showRefModal && (
        <RefModal
          onClose={() => setShowRefModal(false)}
          onAdd={r => addRef(r)}
          alreadyAdded={selectedRefs}
        />
      )}
    </AppLayout>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', flex: 1,
    background: '#0f172a', color: '#f8fafc', height: '100%', overflow: 'hidden',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '0.75rem 1.5rem', background: '#1e293b',
    borderBottom: '1px solid #334155', flexShrink: 0,
  },
  backBtn: { background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 },
  toolbarTitle: { flex: 1, fontSize: 16, fontWeight: 700, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  refsToggleBtn: {
    background: 'none', border: '1px solid #334155', color: '#94a3b8',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
    display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
  },
  refsToggleBtnActive: { background: '#1e3a5f', borderColor: '#6366f1', color: '#a5b4fc' },
  refsToolbarBadge: {
    background: '#6366f1', color: '#fff', borderRadius: 10,
    padding: '1px 6px', fontSize: 11, fontWeight: 700,
  },

  errorBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 16px', background: '#450a0a', borderBottom: '1px solid #f87171',
    flexShrink: 0, gap: 12,
  },
  errorDismiss: {
    background: 'none', border: '1px solid #f87171', color: '#f87171',
    borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0,
  },

  centerMsg: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 14 },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  messagesCol: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' },

  messages: {
    flex: 1, overflowY: 'auto', padding: '1.5rem',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  emptyChat: { textAlign: 'center', color: '#475569', fontSize: 14, marginTop: 40 },

  msgWrapper: { display: 'flex', width: '100%' },
  bubble: {
    maxWidth: '78%', borderRadius: 12, padding: '0.75rem 1rem',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  userBubble: { background: '#312e81', color: '#e0e7ff' },
  aiBubble: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' },
  msgRole: { fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 2 },
  msgRefs: { marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)' },
  msgRefsLabel: { fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 },

  inputArea: {
    borderTop: '1px solid #334155', background: '#1e293b',
    padding: '0.75rem 1rem', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8,
  },
  refsBar: { display: 'flex', flexDirection: 'column', gap: 4 },
  refsBarLabel: { fontSize: 11, color: '#64748b' },
  refChips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  refChip: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: '#0f172a', border: '1px solid #4f46e5',
    borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#a5b4fc',
  },
  refChipReadonly: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: '#0f172a', border: '1px solid #334155',
    borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#94a3b8',
  },
  refRemoveBtn: {
    background: 'none', border: 'none', color: '#f87171',
    cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 0 0 4px',
  },
  refRow: { display: 'flex', alignItems: 'center' },
  addRefBtn: {
    background: 'none', border: '1px dashed #334155', color: '#64748b',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
  },
  textRow: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  textarea: {
    flex: 1, background: '#0f172a', border: '1px solid #334155',
    borderRadius: 8, color: '#f8fafc', fontSize: 14, padding: '0.6rem 0.75rem',
    resize: 'none', outline: 'none', fontFamily: 'inherit',
  },
  sendBtn: {
    background: '#6366f1', border: 'none', color: '#fff',
    borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer',
    fontSize: 18, fontWeight: 700, flexShrink: 0,
    minWidth: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { background: '#334155', cursor: 'not-allowed', color: '#64748b' },

  // New form
  newForm: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: 12,
    maxWidth: 480, margin: '3rem auto', padding: '2rem',
    background: '#1e293b', borderRadius: 12, border: '1px solid #334155',
    alignSelf: 'flex-start', width: '100%',
  },
  newFormTitle: { margin: 0, fontSize: 20, color: '#e2e8f0' },
  label: { fontSize: 12, color: '#94a3b8', fontWeight: 600 },
  input: {
    background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
    color: '#f8fafc', fontSize: 15, padding: '0.6rem 0.75rem', outline: 'none',
  },
  select: {
    background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
    color: '#f8fafc', fontSize: 14, padding: '0.5rem 0.75rem',
  },
  errorMsg: { color: '#f87171', fontSize: 13, margin: 0 },
  createBtn: {
    background: '#6366f1', border: 'none', borderRadius: 8,
    color: '#fff', padding: '0.65rem 1.5rem', cursor: 'pointer',
    fontWeight: 700, fontSize: 15, marginTop: 4,
  },
}

// ── References Panel styles ───────────────────────────────────────────────────

const rp: Record<string, React.CSSProperties> = {
  panel: {
    background: '#0f172a', borderLeft: '1px solid #334155',
    display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease',
    overflow: 'hidden', flexShrink: 0, position: 'relative',
  },
  toggleBtn: {
    position: 'absolute', top: 8, left: 0,
    background: '#1e293b', border: '1px solid #334155',
    color: '#6366f1', cursor: 'pointer', fontSize: 16,
    padding: '4px 6px', borderRadius: '0 6px 6px 0',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    zIndex: 1,
  },
  badgeMini: {
    background: '#6366f1', color: '#fff', borderRadius: 10,
    padding: '1px 4px', fontSize: 10, fontWeight: 700,
  },
  content: {
    paddingTop: 40, overflowY: 'auto', flex: 1,
    display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 12px 8px', borderBottom: '1px solid #1e293b',
  },
  title: { fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' },
  count: {
    background: '#334155', color: '#94a3b8', borderRadius: 10,
    padding: '1px 7px', fontSize: 11,
  },
  empty: { fontSize: 12, color: '#475569', padding: '16px 12px', fontStyle: 'italic' },
  group: { padding: '10px 12px', borderBottom: '1px solid #0f172a' },
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#6366f1', marginBottom: 6, letterSpacing: '0.03em' },
  item: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 4, padding: '4px 0',
  },
  itemTitle: { fontSize: 12, color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  itemCount: { fontSize: 10, color: '#475569', flexShrink: 0 },
}

const ms: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
    width: 480, maxHeight: '75vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.9rem 1rem', borderBottom: '1px solid #334155',
  },
  title: { fontSize: 15, fontWeight: 700, color: '#e2e8f0' },
  closeBtn: { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 },
  tabs: { display: 'flex', borderBottom: '1px solid #334155' },
  tabBtn: {
    flex: 1, background: 'none', border: 'none', borderBottom: '2px solid transparent',
    color: '#94a3b8', cursor: 'pointer', fontSize: 13, padding: '0.6rem 0.5rem', fontWeight: 600,
  },
  tabActive: { color: '#6366f1', borderBottom: '2px solid #6366f1' },
  search: {
    margin: '0.6rem 0.75rem', background: '#0f172a', border: '1px solid #334155',
    borderRadius: 6, color: '#f8fafc', fontSize: 13, padding: '0.45rem 0.75rem', outline: 'none',
  },
  list: { overflowY: 'auto', flex: 1, padding: '0 0.5rem 0.5rem' },
  item: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', background: 'none', border: 'none',
    color: '#cbd5e1', cursor: 'pointer', textAlign: 'left',
    padding: '0.45rem 0.5rem', borderRadius: 6, fontSize: 13,
  },
  itemAdded: { color: '#475569', cursor: 'default' },
  checkmark: { color: '#4ade80', fontSize: 14 },
  hint: { color: '#475569', fontSize: 12, padding: '0.5rem', fontStyle: 'italic' },
}
