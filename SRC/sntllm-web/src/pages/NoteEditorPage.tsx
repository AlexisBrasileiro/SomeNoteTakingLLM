import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import MDEditor from '@uiw/react-md-editor'
import api from '../api/client'
import AppLayout from '../components/AppLayout'
import PaperlessDocumentsPanel from '../components/PaperlessDocumentsPanel'
import type { Project, Note, NoteType } from '../types'

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
  const navState = (location.state as { projectId?: string; noteType?: NoteType; date?: string } | null)
  const presetProjectId = navState?.projectId ?? ''

  const todayIso = new Date().toISOString().split('T')[0]

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [projectId, setProjectId] = useState(presetProjectId)
  const [noteDate, setNoteDate] = useState(navState?.date ?? todayIso)
  const [parentNoteId, setParentNoteId] = useState('')
  const [noteType, setNoteType] = useState<NoteType>(navState?.noteType ?? 0)
  const [projects, setProjects] = useState<Project[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ao trocar para CalendarNote, pré-preenche a data com hoje se estiver vazia
  const handleNoteTypeChange = (t: NoteType) => {
    setNoteType(t)
    if (t === 1 && !noteDate) setNoteDate(todayIso)
    if (t !== 1) setParentNoteId('')
  }

  useEffect(() => {
    api.get<Project[]>('/projects').then(r => setProjects(r.data))
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
      }
      if (isNew) {
        const r = await api.post<Note>('/notes', payload)
        navigate(`/notes/${r.data.id}`, { replace: true })
      } else {
        await api.put(`/notes/${id}`, payload)
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
      navigate('/')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setError(err.response?.data?.message ?? 'Erro ao excluir.')
    }
  }

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

          {noteType === 0 && (
            <>
              <label style={styles.metaLabel}>Nota pai</label>
              <select style={styles.select} value={parentNoteId} onChange={e => setParentNoteId(e.target.value)}>
                <option value="">Nenhuma</option>
                {notes.filter(n => n.id !== id && n.noteType === 0).map(n => (
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
    </AppLayout>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', flex: 1, background: '#0f172a', color: '#f8fafc' },
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
  editorWrapper: { flex: 1, padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column' },
}
