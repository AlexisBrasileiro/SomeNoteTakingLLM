import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import AppLayout from '../components/AppLayout'
import type { Note, Project } from '../types'

type SearchFilters = {
  title: string
  content: string
  tag: string
  projectId: string
  noteDate: string
}

function NoteTreeItem({
  note,
  depth,
  projectName,
  onSelect,
  onMove,
  onCreateChild,
}: {
  note: Note & { children?: Note[] }
  depth: number
  projectName?: string
  onSelect: (id: string) => void
  onMove: () => void
  onCreateChild: (parentId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const handleDragStart = (e: any) => {
    e.dataTransfer.setData('text/plain', note.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: any) => {
    e.preventDefault()
  }

  const handleDrop = async (e: any) => {
    e.preventDefault()
    const draggedId = e.dataTransfer.getData('text/plain')
    if (!draggedId || draggedId === note.id) return
    try {
      await api.patch(`/notes/${draggedId}/move`, {
        projectId: note.projectId || null,
        parentNoteId: note.id,
      })
      onMove()
    } catch (err) {
      console.error('Erro ao mover nota', err)
      onMove()
    }
  }

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div
        style={styles.treeItem}
        onClick={() => onSelect(note.id)}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {note.children && note.children.length > 0 && (
          <button style={styles.expandBtn} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}>
            {expanded ? '▼' : '▶'}
          </button>
        )}
        <div style={styles.treeMain}>
          <span style={styles.treeTitle}>{note.title || 'Sem título'}</span>
          <div style={styles.metaRow}>
            {projectName && <span style={styles.metaBadge}>{projectName}</span>}
            {note.noteDate && <span style={styles.metaBadge}>{new Date(note.noteDate).toLocaleDateString('pt-BR')}</span>}
            {note.tags.map(tag => <span key={tag} style={styles.tagChip}>#{tag}</span>)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={styles.treeDepth}>{note.children?.length ?? 0}</span>
          <button
            title="Nova sub-nota"
            style={styles.addChildBtn}
            onClick={(e) => { e.stopPropagation(); onCreateChild(note.id) }}
          >+</button>
          <span style={styles.treeDepth}>nível {note.depth}</span>
        </div>
      </div>
      {expanded && note.children?.map(child => (
        <NoteTreeItem
          key={child.id}
          note={child}
          depth={depth + 1}
          projectName={projectName}
          onSelect={onSelect}
          onMove={onMove}
          onCreateChild={onCreateChild}
        />
      ))}
    </div>
  )
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [filters, setFilters] = useState<SearchFilters>({ title: '', content: '', tag: '', projectId: '', noteDate: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const reloadNotes = async (nextFilters: SearchFilters = filters) => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {}
      if (nextFilters.title) params.title = nextFilters.title
      if (nextFilters.content) params.content = nextFilters.content
      if (nextFilters.tag) params.tag = nextFilters.tag
      if (nextFilters.projectId) params.projectId = nextFilters.projectId
      if (nextFilters.noteDate) params.noteDate = new Date(nextFilters.noteDate).toISOString()

      const response = await api.get<Note[]>('/notes', { params })
      setNotes(response.data)
    } catch {
      setError('Não foi possível carregar as notas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.get<Project[]>('/projects').then(r => setProjects(r.data)).catch(() => {})
    void reloadNotes()
  }, [])

  const updateFilter = (field: keyof SearchFilters, value: string) => {
    setFilters(current => ({ ...current, [field]: value }))
  }

  const clearFilters = () => {
    const emptyFilters = { title: '', content: '', tag: '', projectId: '', noteDate: '' }
    setFilters(emptyFilters)
    void reloadNotes(emptyFilters)
  }

  const noteMap = new Map<string, Note & { children: Note[] }>()
  notes.forEach(n => noteMap.set(n.id, { ...n, children: [] }))
  const roots: (Note & { children: Note[] })[] = []
  noteMap.forEach(n => {
    if (n.parentNoteId && noteMap.has(n.parentNoteId)) {
      noteMap.get(n.parentNoteId)!.children.push(n)
    } else {
      roots.push(n)
    }
  })

  const projectNameById = new Map(projects.map(project => [project.id, project.name]))

  return (
    <AppLayout>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Notas</h1>
            <p style={styles.subtitle}>Busque por título, conteúdo, tag, data e projeto sem perder a hierarquia.</p>
          </div>
          <button style={styles.newBtn} onClick={() => navigate('/notes/new')}>+ Nova Nota</button>
          <button style={{ ...styles.newBtn, background: '#7c3aed' }} onClick={() => navigate('/import')}>📦 Importar ZIP</button>
        </div>

        <div style={styles.filtersCard}>
          <div style={styles.filtersGrid}>
            <input style={styles.input} placeholder="Filtrar por título" value={filters.title} onChange={e => updateFilter('title', e.target.value)} />
            <input style={styles.input} placeholder="Filtrar por conteúdo" value={filters.content} onChange={e => updateFilter('content', e.target.value)} />
            <input style={styles.input} placeholder="Filtrar por tag" value={filters.tag} onChange={e => updateFilter('tag', e.target.value)} />
            <select style={styles.select} value={filters.projectId} onChange={e => updateFilter('projectId', e.target.value)}>
              <option value="">Todos os projetos</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <input type="date" style={styles.input} value={filters.noteDate} onChange={e => updateFilter('noteDate', e.target.value)} />
          </div>
          <div style={styles.filterActions}>
            <button style={styles.secondaryBtn} onClick={clearFilters}>Limpar</button>
            <button style={styles.primaryBtn} onClick={() => reloadNotes()}>Buscar</button>
          </div>
        </div>

        <div style={styles.tree}>
          {error && <p style={styles.error}>{error}</p>}
          {loading && <p style={styles.empty}>Carregando notas...</p>}
          {!loading && roots.length === 0 && <p style={styles.empty}>Nenhuma nota encontrada para os filtros informados.</p>}
          {!loading && roots.map(n => (
            <NoteTreeItem
              key={n.id}
              note={n}
              depth={0}
              projectName={n.projectId ? projectNameById.get(n.projectId) : undefined}
              onSelect={(id) => navigate(`/notes/${id}`)}
              onMove={() => reloadNotes()}
              onCreateChild={(parentId) => navigate('/notes/new', { state: { parentNoteId: parentId } })}
            />
          ))}
        </div>
      </div>
    </AppLayout>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '2rem', background: 'linear-gradient(180deg, #081120 0%, #0f172a 48%, #131c31 100%)', minHeight: '100%', color: '#f8fafc' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' },
  title: { fontSize: 28, fontWeight: 800, margin: 0 },
  subtitle: { margin: '0.35rem 0 0', color: '#94a3b8', fontSize: 14 },
  newBtn: { padding: '0.7rem 1.35rem', background: '#f97316', border: 'none', borderRadius: 999, color: '#fff', cursor: 'pointer', fontWeight: 700 },
  filtersCard: { background: 'rgba(15, 23, 42, 0.85)', border: '1px solid #223250', borderRadius: 20, padding: '1rem', marginBottom: '1.25rem', boxShadow: '0 16px 50px rgba(3, 7, 18, 0.35)' },
  filtersGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  input: { width: '100%', padding: '0.75rem 0.9rem', background: '#081120', border: '1px solid #223250', borderRadius: 12, color: '#f8fafc', fontSize: 14 },
  select: { width: '100%', padding: '0.75rem 0.9rem', background: '#081120', border: '1px solid #223250', borderRadius: 12, color: '#f8fafc', fontSize: 14 },
  filterActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  primaryBtn: { padding: '0.7rem 1.15rem', background: '#0ea5e9', border: 'none', borderRadius: 12, color: '#fff', cursor: 'pointer', fontWeight: 700 },
  secondaryBtn: { padding: '0.7rem 1.15rem', background: 'transparent', border: '1px solid #334155', borderRadius: 12, color: '#cbd5e1', cursor: 'pointer', fontWeight: 600 },
  tree: { background: 'rgba(15, 23, 42, 0.9)', borderRadius: 20, padding: '1rem', border: '1px solid #223250', boxShadow: '0 16px 50px rgba(3, 7, 18, 0.35)' },
  treeItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '0.75rem 0.9rem', borderRadius: 14, cursor: 'pointer', marginBottom: 8, background: 'rgba(8, 17, 32, 0.95)', border: '1px solid #18253b' },
  expandBtn: { background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', width: 20, fontSize: 10 },
  treeMain: { flex: 1, minWidth: 0 },
  treeTitle: { display: 'block', fontSize: 15, fontWeight: 700, marginBottom: 6 },
  metaRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  metaBadge: { fontSize: 11, color: '#cbd5e1', background: '#172554', borderRadius: 999, padding: '0.2rem 0.55rem' },
  tagChip: { fontSize: 11, color: '#fed7aa', background: '#7c2d12', borderRadius: 999, padding: '0.2rem 0.55rem' },
  treeDepth: { fontSize: 11, color: '#64748b' },
  addChildBtn: { background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, width: 22, height: 22, cursor: 'pointer' },
  empty: { color: '#64748b', textAlign: 'center', padding: '1.5rem 0' },
  error: { color: '#fca5a5', textAlign: 'center', padding: '0.5rem 0 1rem' },
}
