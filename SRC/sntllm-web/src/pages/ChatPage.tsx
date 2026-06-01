import { useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import MarkdownPreview from '@uiw/react-markdown-preview'
import api from '../api/client'
import AppLayout from '../components/AppLayout'
import type { ChatMessage, ChatReference, Note, Project } from '../types/index'
import { useT } from '../context/I18nContext'
import { useSidebarRefresh } from '../context/SidebarRefreshContext'
import { THINKING_COUNT } from '../i18n'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatDetail {
  id: string
  title: string
  projectId?: string | null
  createdAt: string
  messages: ChatMessage[]
}

interface PaperlessTag { id: number; name: string }
interface PaperlessDoc { id: number; title: string; original_file_name?: string }
interface DocumentQueryResult { strategy: string; strategyLabel: string; documents: PaperlessDoc[] }

type SendStatus = 'idle' | 'preparing' | 'thinking' | 'streaming' | 'error'

function ThinkingIndicator({ status }: { status: SendStatus }) {
  const t = useT()
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * THINKING_COUNT))
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (status === 'idle' || status === 'error' || status === 'streaming') return
    setElapsed(0)
    // Pick a random message to start, then rotate randomly every 15s
    setMsgIdx(Math.floor(Math.random() * THINKING_COUNT))
    const ticker = setInterval(() => setElapsed(s => s + 1), 1000)
    const rotator = setInterval(() => setMsgIdx(Math.floor(Math.random() * THINKING_COUNT)), 15_000)
    return () => { clearInterval(ticker); clearInterval(rotator) }
  }, [status])

  if (status === 'idle' || status === 'error' || status === 'streaming') return null

  const label = status === 'preparing' ? t('chat.status.preparing') : t(`thinking.${msgIdx}`)
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const timer = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  return (
    <div style={TI.wrap}>
      <span style={TI.msg}>{label}</span>
      <span style={TI.timer}>{timer}</span>
      <TypingDots />
    </div>
  )
}

const TI: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 16px', background: 'rgba(99,102,241,0.10)',
    borderBottom: '1px solid #6366f133', flexShrink: 0,
    fontSize: 13, color: '#a5b4fc',
  },
  msg: { flex: 1, fontStyle: 'italic' },
  timer: {
    fontVariantNumeric: 'tabular-nums', fontSize: 12,
    color: '#64748b', fontFamily: 'monospace',
  },
}

function refIcon(type: ChatReference['type']) {
  if (type === 'note') return '📝'
  if (type === 'paperless_tag') return '🏷️'
  return '📄'
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span className="chat-dot" />
      <span className="chat-dot" />
      <span className="chat-dot" />
    </span>
  )
}

// ── Add Reference Modal ───────────────────────────────────────────────────────

function RefModal({ onClose, onAdd, alreadyAdded }: {
  onClose: () => void
  onAdd: (ref: ChatReference) => void
  alreadyAdded: ChatReference[]
}) {
  const t = useT()
  const [tab, setTab] = useState<'notes' | 'tags' | 'docs'>('notes')
  const [notes, setNotes] = useState<Note[]>([])
  const [tags, setTags] = useState<PaperlessTag[]>([])
  const [docs, setDocs] = useState<PaperlessDoc[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    setSearch('')
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

  const fl = search.toLowerCase()
  const filteredNotes = notes.filter(n => (n.title ?? 'Sem titulo').toLowerCase().includes(fl))
  const filteredTags  = tags.filter(t => t.name.toLowerCase().includes(fl))
  const filteredDocs  = docs.filter(d => (d.title ?? '').toLowerCase().includes(fl))

  return (
    <div style={M.overlay} onClick={onClose}>
      <div style={M.modal} onClick={e => e.stopPropagation()}>
        <div style={M.header}>
          <span style={M.title}>{t('chat.modal.title')}</span>
          <button style={M.closeBtn} onClick={onClose}>X</button>
        </div>
        <div style={M.tabs}>
          {(['notes', 'tags', 'docs'] as const).map(tb => (
            <button key={tb} style={{ ...M.tabBtn, ...(tab === tb ? M.tabActive : {}) }}
              onClick={() => setTab(tb)}>
              {tb === 'notes' ? t('chat.modal.notes') : tb === 'tags' ? t('chat.modal.tags') : t('chat.modal.docs')}
            </button>
          ))}
        </div>
        <input style={M.search} placeholder={t('common.search')} value={search}
          onChange={e => setSearch(e.target.value)} autoFocus />
        <div style={M.list}>
          {loading && <div style={M.hint}>{t('common.loading')}</div>}
          {!loading && tab === 'notes' && filteredNotes.map(n => {
            const added = isAdded('note', n.id)
            return (
              <button key={n.id} style={{ ...M.item, ...(added ? M.itemAdded : {}) }}
                onClick={() => !added && onAdd({ type: 'note', id: n.id, title: n.title ?? 'Sem titulo' })}>
                {n.title ?? 'Sem titulo'}
                {added && <span style={M.checkmark}>v</span>}
              </button>
            )
          })}
          {!loading && tab === 'tags' && filteredTags.map(tg => {
            const added = isAdded('paperless_tag', String(tg.id))
            return (
              <button key={tg.id} style={{ ...M.item, ...(added ? M.itemAdded : {}) }}
                onClick={() => !added && onAdd({ type: 'paperless_tag', id: String(tg.id), title: tg.name })}>
                {tg.name}
                {added && <span style={M.checkmark}>v</span>}
              </button>
            )
          })}
          {!loading && tab === 'docs' && filteredDocs.map(d => {
            const added = isAdded('paperless_document', String(d.id))
            return (
              <button key={d.id} style={{ ...M.item, ...(added ? M.itemAdded : {}) }}
                onClick={() => !added && onAdd({ type: 'paperless_document', id: String(d.id), title: d.title ?? d.original_file_name ?? ('Doc #' + d.id) })}>
                {d.title ?? d.original_file_name ?? ('Doc #' + d.id)}
                {added && <span style={M.checkmark}>v</span>}
              </button>
            )
          })}
          {!loading && tab === 'notes' && filteredNotes.length === 0 && <div style={M.hint}>{t('chat.modal.noNotes')}</div>}
          {!loading && tab === 'tags'  && filteredTags.length === 0  && <div style={M.hint}>{t('chat.modal.noTags')}</div>}
          {!loading && tab === 'docs'  && filteredDocs.length === 0  && <div style={M.hint}>{t('chat.modal.noDocs')}</div>}
        </div>
      </div>
    </div>
  )
}

// ── References Panel ──────────────────────────────────────────────────────────

function RefsPanel({ messages, open, onToggle }: {
  messages: ChatMessage[]
  open: boolean
  onToggle: () => void
}) {
  const t = useT()
  const allRefs = useMemo(() => {
    const countMap = new Map<string, number>()
    const seen = new Map<string, ChatReference>()
    for (const msg of messages) {
      for (const r of (msg.references ?? [])) {
        const key = r.type + ':' + r.id
        countMap.set(key, (countMap.get(key) ?? 0) + 1)
        if (!seen.has(key)) seen.set(key, r)
      }
    }
    return Array.from(seen.entries()).map(([k, r]) => ({ ...r, count: countMap.get(k) ?? 1 }))
  }, [messages])

  const notes   = allRefs.filter(r => r.type === 'note')
  const tags    = allRefs.filter(r => r.type === 'paperless_tag')
  const docRefs = allRefs.filter(r => r.type === 'paperless_document')

  return (
    <div style={{ ...RP.panel, width: open ? 260 : 36, minWidth: open ? 260 : 36 }}>
      <button style={RP.toggleBtn} onClick={onToggle}>
        {open ? '>' : '<'}
        {!open && allRefs.length > 0 && <span style={RP.badge}>{allRefs.length}</span>}
      </button>
      {open && (
        <div style={RP.content}>
          <div style={RP.panelHeader}>
            <span style={RP.panelTitle}>{t('chat.refs.panel.title')}</span>
            <span style={RP.panelCount}>{allRefs.length}</span>
          </div>
          {allRefs.length === 0 && <p style={RP.empty}>{t('chat.refs.panel.empty')}</p>}
          {notes.length > 0 && (
            <div style={RP.group}>
              <div style={RP.groupLabel}>{t('chat.refs.panel.notes')}</div>
              {notes.map(r => (
                <div key={r.id} style={RP.item}>
                  <span style={RP.itemTitle}>{r.title}</span>
                  <span style={RP.itemCount}>x{r.count}</span>
                </div>
              ))}
            </div>
          )}
          {tags.length > 0 && (
            <div style={RP.group}>
              <div style={RP.groupLabel}>{t('chat.refs.panel.tags')}</div>
              {tags.map(r => (
                <div key={r.id} style={RP.item}>
                  <span style={RP.itemTitle}>{r.title}</span>
                  <span style={RP.itemCount}>x{r.count}</span>
                </div>
              ))}
            </div>
          )}
          {docRefs.length > 0 && (
            <div style={RP.group}>
              <div style={RP.groupLabel}>{t('chat.refs.panel.docs')}</div>
              {docRefs.map(r => (
                <div key={r.id} style={RP.item}>
                  <span style={RP.itemTitle}>{r.title}</span>
                  <span style={RP.itemCount}>x{r.count}</span>
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
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const t = useT()
  const { refresh: refreshSidebar } = useSidebarRefresh()

  const [projects, setProjects]         = useState<Project[]>([])
  const [chat, setChat]                 = useState<ChatDetail | null>(null)
  const [loadError, setLoadError]       = useState<string | null>(null)
  const [isLoading, setIsLoading]       = useState(false)

  const [newTitle, setNewTitle]         = useState('')
  const [newProjectId, setNewProjectId] = useState('')
  const [creating, setCreating]         = useState(false)
  const [createErr, setCreateErr]       = useState<string | null>(null)

  const [input, setInput]               = useState('')
  const [contextDays, setContextDays]   = useState(90)
  const [selectedRefs, setSelectedRefs] = useState<ChatReference[]>([])
  const [sendStatus, setSendStatus]     = useState<SendStatus>('idle')
  const [sendError, setSendError]       = useState<string | null>(null)
  const [showRefModal, setShowRefModal] = useState(false)
  const [refsPanelOpen, setRefsPanelOpen] = useState(false)
  const [inputError, setInputError] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)

  const isSending = sendStatus === 'preparing' || sendStatus === 'thinking' || sendStatus === 'streaming'

  useEffect(() => {
    api.get<Project[]>('/projects').then(r => setProjects(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (isNew || !id) return
    setIsLoading(true)
    setLoadError(null)
    api.get<ChatDetail>('/chats/' + id)
      .then(r => setChat(r.data))
      .catch(() => setLoadError('Nao foi possivel carregar o chat.'))
      .finally(() => setIsLoading(false))
  }, [id, isNew])

  const lastMessageContent = chat?.messages[chat.messages.length - 1]?.content ?? ''
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat?.messages.length, lastMessageContent])

  async function handleCreate() {
    const title = newTitle.trim()
    if (!title) return
    setCreating(true)
    setCreateErr(null)
    try {
      const r = await api.post<ChatDetail>('/chats', { title, projectId: newProjectId || null })
      navigate('/chat/' + r.data.id, { replace: true })
    } catch {
      setCreateErr('Erro ao criar chat.')
    } finally {
      setCreating(false)
    }
  }

  async function handleProjectChange(projectId: string) {
    if (!chat) return
    try {
      await api.patch('/chats/' + chat.id, { projectId: projectId || null })
      setChat(prev => prev ? { ...prev, projectId: projectId || null } : prev)
    } catch { /* ignore */ }
  }

  async function handleSend() {
    console.log('[ChatPage] handleSend called — id:', id, 'isNew:', isNew, 'isSending:', isSending, 'input:', JSON.stringify(input))
    const content = input.trim()
    if (isSending) { console.log('[ChatPage] aborted: isSending'); return }
    if (!content) {
      console.log('[ChatPage] aborted: empty input')
      setInputError(true)
      setTimeout(() => setInputError(false), 800)
      textareaRef.current?.focus()
      return
    }
    if (!id || isNew) { console.log('[ChatPage] aborted: isNew or no id'); return }

    const refs = selectedRefs.length > 0 ? [...selectedRefs] : undefined
    const userTempId = 'temp-user-' + Date.now()
    const streamingId = 'temp-stream-' + Date.now()

    setInputError(false)
    setChat(prev => prev ? {
      ...prev,
      messages: [...prev.messages,
        { id: userTempId, role: 'user', content, references: refs, createdAt: new Date().toISOString() },
        { id: streamingId, role: 'assistant', content: '', references: undefined, createdAt: new Date().toISOString() },
      ],
    } : prev)
    setInput('')
    setSelectedRefs([])
    setSendError(null)
    setSendStatus('preparing')
    if (refs && refs.length > 0) setRefsPanelOpen(true)

    console.log('[ChatPage] calling streaming POST /chats/' + id + '/messages/stream')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch('/api/v1/chats/' + id + '/messages/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({ content, references: refs, contextDays }),
      })

      if (!response.ok || !response.body) {
        let errMsg = 'Erro ao enviar mensagem.'
        try {
          const errData = await response.json()
          errMsg = errData?.detail ?? errData?.message ?? errData?.title ?? errMsg
        } catch { /* ignore parse error */ }
        throw new Error(errMsg)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (!data) continue

          let evt: { type: string; content?: string; message?: ChatMessage; detail?: string }
          try { evt = JSON.parse(data) } catch { continue }

          if (evt.type === 'ping') {
            // keep-alive — ignore
          } else if (evt.type === 'thinking') {
            setSendStatus('thinking')
          } else if (evt.type === 'token' && evt.content) {
            setSendStatus('streaming')
            setChat(prev => prev ? {
              ...prev,
              messages: prev.messages.map(m =>
                m.id === streamingId ? { ...m, content: m.content + evt.content! } : m
              ),
            } : prev)
          } else if (evt.type === 'done' && evt.message) {
            setChat(prev => prev ? {
              ...prev,
              messages: [
                ...prev.messages.filter(m => m.id !== userTempId && m.id !== streamingId),
                evt.message!,
              ],
            } : prev)
          } else if (evt.type === 'error') {
            throw new Error(evt.detail ?? 'Erro desconhecido do assistente.')
          }
        }
      }

      setSendStatus('idle')
      refreshSidebar()
    } catch (e: unknown) {
      console.error('[ChatPage] send error:', e)
      const msg = (e instanceof Error ? e.message : null) ?? 'Erro ao enviar mensagem.'
      setSendError(msg)
      setSendStatus('error')
      setChat(prev => prev ? {
        ...prev,
        messages: prev.messages.filter(m => m.id !== userTempId && m.id !== streamingId),
      } : prev)
      setInput(content)
      if (refs) setSelectedRefs(refs)
    }
  }

  function addRef(ref: ChatReference) {
    setSelectedRefs(prev => [...prev.filter(r => !(r.type === ref.type && r.id === ref.id)), ref])
  }

  function removeRef(ref: ChatReference) {
    setSelectedRefs(prev => prev.filter(r => !(r.type === ref.type && r.id === ref.id)))
  }

  // ── New Chat Form ─────────────────────────────────────────────────────────

  if (isNew) {
    return (
      <AppLayout>
        <div style={S.newContainer}>
          <div style={S.newCard}>
            <h2 style={S.newTitle}>{t('chat.new.title')}</h2>
            <label style={S.label}>{t('chat.new.titleLabel')}</label>
            <input
              style={S.textInput}
              placeholder={t('chat.new.titlePh')}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <label style={S.label}>{t('chat.new.projectLabel')}</label>
            <select style={S.selectInput} value={newProjectId} onChange={e => setNewProjectId(e.target.value)}>
              <option value="">{t('chat.new.projectNone')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {createErr && <p style={S.errText}>{createErr}</p>}
            <button
              style={creating || !newTitle.trim() ? { ...S.primaryBtn, ...S.disabledBtn } : S.primaryBtn}
              onClick={handleCreate}
              disabled={creating || !newTitle.trim()}
            >
              {creating ? t('chat.new.creating') : t('chat.new.create')}
            </button>
          </div>
        </div>
      </AppLayout>
    )
  }

  // ── Existing Chat View ────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div style={S.page}>

        {/* Toolbar */}
        <div style={S.toolbar}>
          <button style={S.backBtn} onClick={() => navigate(-1)}>{t('chat.toolbar.back')}</button>
          <span style={S.chatTitle}>{chat?.title ?? '...'}</span>
          <select
            style={S.projectSel}
            value={chat?.projectId ?? ''}
            onChange={e => handleProjectChange(e.target.value)}
          >
            <option value="">{t('chat.toolbar.noProject')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            style={{ ...S.projectSel, maxWidth: 130 }}
            value={contextDays}
            onChange={e => setContextDays(Number(e.target.value))}
            title="Janela de contexto automático (notas do projeto)"
          >
            <option value={7}>{t('chat.toolbar.ctx7')}</option>
            <option value={30}>{t('chat.toolbar.ctx30')}</option>
            <option value={60}>{t('chat.toolbar.ctx60')}</option>
            <option value={90}>{t('chat.toolbar.ctx90')}</option>
            <option value={180}>{t('chat.toolbar.ctx180')}</option>
            <option value={365}>{t('chat.toolbar.ctx365')}</option>
          </select>
          <button
            style={refsPanelOpen ? { ...S.iconBtn, ...S.iconBtnActive } : S.iconBtn}
            onClick={() => setRefsPanelOpen(o => !o)}
          >
            {t('chat.toolbar.refs')}
            {(chat?.messages ?? []).some(m => (m.references ?? []).length > 0) && (
              <span style={S.badge}>
                {new Set((chat?.messages ?? []).flatMap(m => m.references ?? []).map(r => r.type + ':' + r.id)).size}
              </span>
            )}
          </button>
        </div>

        {/* Status */}
        <ThinkingIndicator status={sendStatus} />
        {sendStatus === 'streaming' && (
          <div style={S.statusBar}>
            <span style={{ color: '#34d399', fontSize: 12, fontWeight: 600 }}>{t('chat.status.streaming')}</span>
          </div>
        )}
        {sendStatus === 'error' && sendError && (
          <div style={S.errBar}>
            <span>{sendError}</span>
            <button style={S.errDismiss} onClick={() => { setSendStatus('idle'); setSendError(null) }}>{t('common.close')}</button>
          </div>
        )}

        {/* Body */}
        <div style={S.body}>
          <div style={S.messagesCol}>

            {/* Messages */}
            <div style={S.messageList}>
              {isLoading && <p style={S.hint}>{t('chat.messages.loading')}</p>}
              {loadError && <p style={{ ...S.hint, color: '#f87171' }}>{loadError}</p>}
              {!isLoading && !loadError && (chat?.messages.length ?? 0) === 0 && (
                <p style={S.hint}>{t('chat.messages.empty')}</p>
              )}

              {(chat?.messages ?? []).map(msg => (
                <div key={msg.id} style={{
                  ...S.msgRow,
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  opacity: msg.id.startsWith('temp-') ? 0.7 : 1,
                }}>
                  <div style={{ ...S.bubble, ...(msg.role === 'user' ? S.userBubble : S.aiBubble) }}>
                    <div style={S.msgRole}>{msg.role === 'user' ? t('chat.role.user') : t('chat.role.assistant')}</div>
                    <div data-color-mode="dark">
                      <MarkdownPreview source={msg.content}
                        style={{ background: 'transparent', color: 'inherit', fontSize: 14 }} />
                    </div>
                    {(msg.references ?? []).length > 0 && (
                      <div style={S.msgRefs}>
                        <span style={S.msgRefsLabel}>{t('chat.refs.label')}</span>
                        <div style={S.chips}>
                          {(msg.references ?? []).map(r => (
                            <span key={r.type + ':' + r.id} style={S.chipReadonly}>
                              {refIcon(r.type)} {r.title}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isSending && (chat?.messages ?? []).every(m => !m.id.startsWith('temp-stream-') || m.content === '') && (
                <div style={{ ...S.msgRow, justifyContent: 'flex-start' }}>
                  <div style={{ ...S.bubble, ...S.aiBubble }}>
                    <div style={S.msgRole}>{t('chat.role.assistant')}</div>
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={S.inputArea}>
              {selectedRefs.length > 0 && (
                <div>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{t('chat.input.thisMsg')}</span>
                  <div style={S.chips}>
                    {selectedRefs.map(r => (
                      <span key={r.type + ':' + r.id} style={S.chip}>
                        {refIcon(r.type)} {r.title}
                        <button style={S.chipRemove} onClick={() => removeRef(r)}>x</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <form
                style={S.inputRow}
                onSubmit={e => {
                  e.preventDefault()
                  console.log('[ChatPage] form submit — input:', JSON.stringify(input), 'isSending:', isSending)
                  handleSend()
                }}
              >
                <button
                  type="button"
                  style={S.addRefBtn}
                  onClick={() => setShowRefModal(true)}
                  disabled={isSending}
                >
                  {t('chat.input.addRef')}
                </button>
                <textarea
                  ref={textareaRef}
                  style={{ ...S.textarea, ...(inputError ? S.textareaError : {}) }}
                  placeholder={isSending ? t('chat.input.waiting') : t('chat.input.ph')}
                  value={input}
                  onChange={e => { setInput(e.target.value); setInputError(false) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      console.log('[ChatPage] Enter key — input:', JSON.stringify(input))
                      handleSend()
                    }
                  }}
                  rows={3}
                  disabled={isSending}
                />
                <button
                  type="submit"
                  style={isSending ? { ...S.sendBtn, ...S.sendBtnBusy } : S.sendBtn}
                  title={t('chat.input.send')}
                >
                  {isSending ? '...' : '▶'}
                </button>
              </form>
            </div>
          </div>

          <RefsPanel
            messages={chat?.messages ?? []}
            open={refsPanelOpen}
            onToggle={() => setRefsPanelOpen(o => !o)}
          />
        </div>

        {showRefModal && (
          <RefModal
            onClose={() => setShowRefModal(false)}
            onAdd={r => { addRef(r); setShowRefModal(false) }}
            alreadyAdded={selectedRefs}
          />
        )}
      </div>
    </AppLayout>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
    background: '#0f172a', color: '#f8fafc', overflow: 'hidden',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 16px', background: '#1e293b',
    borderBottom: '1px solid #334155', flexShrink: 0,
  },
  backBtn: {
    background: 'none', border: 'none', color: '#94a3b8',
    cursor: 'pointer', fontSize: 13, flexShrink: 0,
  },
  chatTitle: {
    flex: 1, fontSize: 15, fontWeight: 700, color: '#f8fafc',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  projectSel: {
    background: '#0f172a', border: '1px solid #334155', color: '#94a3b8',
    borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer',
    maxWidth: 180, flexShrink: 0,
  },
  iconBtn: {
    background: 'none', border: '1px solid #334155', color: '#94a3b8',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
    display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
  },
  iconBtnActive: { background: '#1e3a5f', borderColor: '#6366f1', color: '#a5b4fc' },
  badge: {
    background: '#6366f1', color: '#fff', borderRadius: 10,
    padding: '1px 6px', fontSize: 11, fontWeight: 700,
  },
  statusBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 16px', background: 'rgba(99,102,241,0.08)',
    borderBottom: '1px solid #6366f133', flexShrink: 0,
  },
  errBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 16px', background: '#450a0a',
    borderBottom: '1px solid #f87171', flexShrink: 0, gap: 12,
  },
  errDismiss: {
    background: 'none', border: '1px solid #f87171', color: '#f87171',
    borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0,
  },
  body: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
  messagesCol: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' },
  messageList: {
    flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem',
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  hint: { textAlign: 'center', color: '#475569', fontSize: 14, marginTop: 32 },
  msgRow: { display: 'flex', width: '100%' },
  bubble: {
    maxWidth: '78%', borderRadius: 12, padding: '10px 14px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  userBubble: { background: '#312e81', color: '#e0e7ff' },
  aiBubble: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' },
  msgRole: { fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 2 },
  msgRefs: { marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)' },
  msgRefsLabel: { fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 },
  inputArea: {
    borderTop: '1px solid #334155', background: '#1e293b',
    padding: '10px 14px', flexShrink: 0,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  inputRow: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  addRefBtn: {
    background: 'none', border: '1px solid #334155', color: '#64748b',
    borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontSize: 12, flexShrink: 0,
  },
  textarea: {
    flex: 1, background: '#0f172a', border: '1px solid #334155',
    borderRadius: 8, color: '#f8fafc', fontSize: 14,
    padding: '8px 10px', resize: 'none', outline: 'none', fontFamily: 'inherit',
  },
  textareaError: {
    border: '1px solid #ef4444',
    boxShadow: '0 0 0 2px rgba(239,68,68,0.25)',
  },
  sendBtn: {
    background: '#6366f1', border: 'none', color: '#fff',
    borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
    fontSize: 16, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 46,
  },
  sendBtnBusy: { background: '#334155', cursor: 'not-allowed' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: '#0f172a', border: '1px solid #4f46e5',
    borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#a5b4fc',
  },
  chipReadonly: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: '#0f172a', border: '1px solid #334155',
    borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#94a3b8',
  },
  chipRemove: {
    background: 'none', border: 'none', color: '#f87171',
    cursor: 'pointer', fontSize: 14, lineHeight: '1', padding: '0 0 0 4px',
  },
  newContainer: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0f172a',
  },
  newCard: {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
    padding: '2rem', width: '100%', maxWidth: 440,
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  newTitle: { fontSize: 20, fontWeight: 700, color: '#f8fafc', margin: 0 },
  label: { fontSize: 13, color: '#94a3b8', fontWeight: 600 },
  textInput: {
    background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
    color: '#f8fafc', fontSize: 14, padding: '8px 12px', outline: 'none',
  },
  selectInput: {
    background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
    color: '#f8fafc', fontSize: 14, padding: '8px 12px', cursor: 'pointer',
  },
  errText: { color: '#f87171', fontSize: 13, margin: 0 },
  primaryBtn: {
    background: '#6366f1', border: 'none', color: '#fff', borderRadius: 8,
    padding: '10px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600,
    marginTop: 4,
  },
  disabledBtn: { background: '#334155', cursor: 'not-allowed', color: '#64748b' },
}

const RP: Record<string, React.CSSProperties> = {
  panel: {
    background: '#0f172a', borderLeft: '1px solid #334155',
    display: 'flex', flexDirection: 'column',
    transition: 'width 0.2s ease', overflow: 'hidden',
    flexShrink: 0, position: 'relative',
  },
  toggleBtn: {
    position: 'absolute', top: 8, left: 0, zIndex: 2,
    background: '#1e293b', border: '1px solid #334155',
    color: '#6366f1', cursor: 'pointer', fontSize: 14,
    padding: '4px 6px', borderRadius: '0 6px 6px 0',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
  },
  badge: {
    background: '#6366f1', color: '#fff', borderRadius: 10,
    padding: '1px 4px', fontSize: 10, fontWeight: 700,
  },
  content: { paddingTop: 44, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' },
  panelHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 12px 8px', borderBottom: '1px solid #1e293b',
  },
  panelTitle: { fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' },
  panelCount: {
    background: '#334155', color: '#94a3b8', borderRadius: 10, padding: '1px 7px', fontSize: 11,
  },
  empty: { fontSize: 12, color: '#475569', padding: '12px', fontStyle: 'italic', margin: 0 },
  group: { padding: '10px 12px', borderBottom: '1px solid #1e293b' },
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#6366f1', marginBottom: 6 },
  item: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 4, padding: '3px 0',
  },
  itemTitle: { fontSize: 12, color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  itemCount: { fontSize: 10, color: '#475569', flexShrink: 0 },
}

const M: Record<string, React.CSSProperties> = {
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
    padding: '12px 16px', borderBottom: '1px solid #334155',
  },
  title:    { fontSize: 15, fontWeight: 700, color: '#e2e8f0' },
  closeBtn: { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 },
  tabs:     { display: 'flex', borderBottom: '1px solid #334155' },
  tabBtn: {
    flex: 1, background: 'none', border: 'none', borderBottom: '2px solid transparent',
    color: '#94a3b8', cursor: 'pointer', fontSize: 13, padding: '8px 6px', fontWeight: 600,
  },
  tabActive: { color: '#6366f1', borderBottom: '2px solid #6366f1' },
  search: {
    margin: '8px 12px', background: '#0f172a', border: '1px solid #334155',
    borderRadius: 6, color: '#f8fafc', fontSize: 13, padding: '6px 10px', outline: 'none',
  },
  list: { flex: 1, overflowY: 'auto', padding: '4px 0' },
  item: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
    color: '#e2e8f0', fontSize: 13, padding: '8px 16px', textAlign: 'left',
  },
  itemAdded: { color: '#475569', cursor: 'default' },
  checkmark: { color: '#22c55e', fontWeight: 700 },
  hint: { color: '#475569', fontSize: 13, padding: '16px', textAlign: 'center' },
}
