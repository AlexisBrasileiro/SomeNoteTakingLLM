import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import MDEditor from '@uiw/react-md-editor'
import api from '../api/client'
import AppLayout from '../components/AppLayout'
import PaperlessDocumentsPanel from '../components/PaperlessDocumentsPanel'
import type { Project, Note, NoteType } from '../types'
import { useSidebarRefresh } from '../context/SidebarRefreshContext'

const NOTE_TYPE_LABELS: Record<number, string> = {
  0: '📝 Nota Livre',
  1: '📅 Nota de Calendário',
  2: '📄 Documento',
}

export default function NoteEditorPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const location = useLocation()
  const navState = (location.state as { projectId?: string; noteType?: NoteType; date?: string; parentNoteId?: string } | null)
  const presetProjectId = navState?.projectId ?? ''
  const { refresh: refreshSidebar } = useSidebarRefresh()

  const todayIso = new Date().toISOString().split('T')[0]

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [projectId, setProjectId] = useState(presetProjectId)
  const [noteDate, setNoteDate] = useState(navState?.date ?? todayIso)
  const [parentNoteId, setParentNoteId] = useState(navState?.parentNoteId ?? '')
  const [noteType, setNoteType] = useState<NoteType>(navState?.noteType ?? 0)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sanitizeTag = (value: string) => value.trim()

  const addTag = (value: string) => {
    const nextTag = sanitizeTag(value)
    if (!nextTag) return
    setTags(current => current.some(tag => tag.toLowerCase() === nextTag.toLowerCase()) ? current : [...current, nextTag])
    setTagInput('')
  }

  const removeTag = (tagToRemove: string) => {
    setTags(current => current.filter(tag => tag !== tagToRemove))
  }

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag(tagInput)
    }
  }

  // Ao trocar para CalendarNote, pré-preenche a data com hoje se estiver vazia
  const handleNoteTypeChange = (t: NoteType) => {
    setNoteType(t)
    if (t === 1 && !noteDate) setNoteDate(todayIso)
    // Apenas limpar parent quando for Chat (tipo 3), permitir aninhar para Free/Calendar/Document
    if (t === 3) setParentNoteId('')
  }

  useEffect(() => {
    api.get<Project[]>('/projects').then(r => {
      setProjects(r.data)
      // Pre-select Particular project for new notes (if no preset from navigation state)
      if (isNew && !presetProjectId) {
        const particular = r.data.find(p => p.name.startsWith('Particular.') || p.name === 'Particular')
        if (particular) setProjectId(particular.id)
      }
    })
    api.get<Note[]>('/notes').then(r => setNotes(r.data))
    if (!isNew && id) {
      api.get<Note>(`/notes/${id}`).then(r => {
        const n = r.data
        setTitle(n.title ?? '')
        setContent(n.content ?? '')
        setProjectId(n.projectId ?? '')
        setNoteDate(n.noteDate ? n.noteDate.split('T')[0] : '')
        setParentNoteId(n.parentNoteId ?? '')
        setNoteType(n.noteType)
        setTags(n.directTags ?? n.tags ?? [])
      })
    }
  }, [id, isNew])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        title: title || null,
        content: content || null,
        projectId: projectId || null,
        noteDate: noteDate ? new Date(noteDate).toISOString() : null,
        parentNoteId: parentNoteId || null,
        noteType,
        tags,
      }
      if (isNew) {
        const r = await api.post<Note>('/notes', payload)
        refreshSidebar()
        navigate(`/notes/${r.data.id}`, { replace: true })
      } else {
        await api.put(`/notes/${id}`, payload)
        refreshSidebar()
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setError(err.response?.data?.message ?? 'Erro ao salvar nota.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!id || isNew) return
    if (!window.confirm('Excluir esta nota?')) return
    try {
      await api.delete(`/notes/${id}`)
      refreshSidebar()
      navigate('/')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setError(err.response?.data?.message ?? 'Erro ao excluir.')
    }
  }

  const parentNote = notes.find(note => note.id === parentNoteId)
  const inheritedTags = parentNote?.tags ?? []
  const effectiveTags = Array.from(new Set([...inheritedTags, ...tags].map(tag => tag.trim()).filter(Boolean)))

  return (
    <AppLayout>
      <div style={styles.container} data-color-mode="dark">
        <div style={styles.toolbar}>
          <button style={styles.backBtn} onClick={() => navigate(-1)}>← Voltar</button>
          <input
            style={styles.titleInput}
            placeholder="Título da nota"
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          />
          <div style={styles.toolbarActions}>
            {error && <span style={styles.errorMsg}>{error}</span>}
            {!isNew && (
              <button style={styles.deleteBtn} onClick={handleDelete}>Excluir</button>
            )}
            <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>

        <div style={styles.meta}>
          <label style={styles.metaLabel}>Tipo</label>
          <select
            style={styles.select}
            value={noteType}
            onChange={e => handleNoteTypeChange(Number(e.target.value) as NoteType)}
          >
            {([0, 1, 2] as NoteType[]).map(t => (
              <option key={t} value={t}>{NOTE_TYPE_LABELS[t]}</option>
            ))}
          </select>

          <label style={styles.metaLabel}>Projeto</label>
          <select style={styles.select} value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">Nenhum</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {noteType === 1 && (
            <>
              <label style={styles.metaLabel}>Data</label>
              <input type="date" style={styles.dateInput} value={noteDate} onChange={e => setNoteDate(e.target.value)} />
              <span style={{ fontSize: 11, color: '#64748b' }}>
                A nota será aninhada automaticamente na data selecionada
              </span>
            </>
          )}

          {noteType !== 3 && (
            <>
              <label style={styles.metaLabel}>Nota pai</label>
              <select style={styles.select} value={parentNoteId} onChange={e => setParentNoteId(e.target.value)}>
                <option value="">Nenhuma</option>
                {notes.filter(n => n.id !== id && n.noteType !== 3).map(n => (
                  <option key={n.id} value={n.id}>{n.title || 'Sem título'} (nível {n.depth})</option>
                ))}
              </select>
            </>
          )}

        </div>

        <div style={styles.editorWrapper}>
          <MDEditor
            value={content}
            onChange={(v) => setContent(v ?? '')}
            height="100%"
            style={{ flex: 1, minHeight: 400 }}
          />
          <div style={{ display: 'flex', gap: 20, marginTop: 20, flexWrap: 'wrap' }}>
          <div style={{ width: '48%', marginRight: '1%' }}>
            <div>
              {projectId && (
                <div style={{ marginTop: 16 }}>
                  <PaperlessDocumentsPanel
                    projectId={projectId}
                    projectName={projects.find(p => p.id === projectId)?.name}
                  />
                </div>
              )}
            </div>
          </div>
          <div style={{ width: '48%', marginLeft: '1%' }}>
            <div style={styles.tagsPanel}>
              <label style={styles.metaLabel}>Tags próprias</label>
              <div style={styles.tagsComposer}>
                <input
                  style={styles.tagInput}
                  placeholder="Digite uma tag e pressione Enter"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                />
                <button style={styles.tagAddBtn} type="button" onClick={() => addTag(tagInput)}>Adicionar</button>
              </div>
              <div style={styles.tagList}>
                {tags.length === 0 && <span style={styles.tagHint}>Nenhuma tag própria definida.</span>}
                {tags.map(tag => (
                  <button key={tag} type="button" style={styles.tagButton} onClick={() => removeTag(tag)}>
                    #{tag} ×
                  </button>
                ))}
              </div>
              <div style={{display: 'none'}}>
              {parentNoteId && inheritedTags.length > 0 && (
                <div style={styles.inheritanceBox}>
                  <span style={styles.inheritanceTitle}>Tags herdadas da nota pai</span>
                  <div style={styles.tagList}>
                    {inheritedTags.map(tag => <span key={tag} style={styles.inheritedTag}>#{tag}</span>)}
                  </div>
                </div>
              )}
              </div>
              {effectiveTags.length > 0 && (
                <div style={styles.inheritanceBox}>
                  <span style={styles.inheritanceTitle}>Tags efetivas desta nota</span>
                  <div style={styles.tagList}>
                    {effectiveTags.map(tag => <span key={tag} style={styles.effectiveTag}>#{tag}</span>)}
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#0f172a', color: '#f8fafc', overflowY: 'auto' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 12, padding: '1rem 1.5rem', background: '#1e293b', borderBottom: '1px solid #334155' },
  backBtn: { background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 },
  titleInput: { flex: 1, background: 'none', border: 'none', color: '#f8fafc', fontSize: 18, fontWeight: 700, outline: 'none' },
  toolbarActions: { display: 'flex', alignItems: 'center', gap: 8 },
  errorMsg: { color: '#f87171', fontSize: 13 },
  deleteBtn: { padding: '0.5rem 1rem', background: '#7f1d1d', border: 'none', borderRadius: 8, color: '#fca5a5', cursor: 'pointer', fontSize: 13 },
  saveBtn: { padding: '0.5rem 1.25rem', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600 },
  meta: { display: 'flex', alignItems: 'center', gap: 12, padding: '0.75rem 1.5rem', background: '#1e293b', borderBottom: '1px solid #334155', flexWrap: 'wrap' },
  metaLabel: { color: '#94a3b8', fontSize: 12, fontWeight: 500 },
  select: { padding: '0.4rem 0.75rem', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#f8fafc', fontSize: 13 },
  dateInput: { padding: '0.4rem 0.75rem', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#f8fafc', fontSize: 13 },
  tagsPanel: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320, flex: '1 1 320px' },
  tagsComposer: { display: 'flex', gap: 8 },
  tagInput: { flex: 1, padding: '0.55rem 0.75rem', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f8fafc', fontSize: 13 },
  tagAddBtn: { padding: '0.55rem 0.85rem', background: '#0ea5e9', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600 },
  tagList: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  tagButton: { padding: '0.35rem 0.7rem', background: '#7c2d12', border: '1px solid #9a3412', borderRadius: 999, color: '#ffedd5', cursor: 'pointer', fontSize: 12 },
  tagHint: { color: '#64748b', fontSize: 12 },
  inheritanceBox: { display: 'flex', flexDirection: 'column', gap: 6, padding: '0.7rem 0.85rem', border: '1px solid #334155', borderRadius: 10, background: '#111827' },
  inheritanceTitle: { color: '#cbd5e1', fontSize: 12, fontWeight: 600 },
  inheritedTag: { padding: '0.3rem 0.6rem', background: '#172554', borderRadius: 999, color: '#bfdbfe', fontSize: 12 },
  effectiveTag: { padding: '0.3rem 0.6rem', background: '#14532d', borderRadius: 999, color: '#dcfce7', fontSize: 12 },
  editorWrapper: { flex: 1, padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column' },
}
