import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import type { Note } from '../types'

function NoteTreeItem({ note, depth, onSelect, onMove, onCreateChild }: { note: Note & { children?: Note[] }, depth: number, onSelect: (id: string) => void, onMove: () => void, onCreateChild: (parentId: string) => void }) {
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
      const r = await api.get<Note>(`/notes/${draggedId}`)
      const dragged = r.data
      const payload = {
        title: dragged.title ?? null,
        content: dragged.content ?? null,
        projectId: dragged.projectId || null,
        parentNoteId: note.id,
        noteDate: dragged.noteDate ? new Date(dragged.noteDate).toISOString() : null,
        noteType: dragged.noteType,
      }
      // send update to set new parent
      await api.put(`/notes/${draggedId}`, payload)
      onMove()
    } catch (err) {
      // ignore, backend will respond with meaningful error
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
        <span style={styles.treeTitle}>{note.title || 'Sem título'}</span>
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
        <NoteTreeItem key={child.id} note={child} depth={depth + 1} onSelect={onSelect} onMove={onMove} onCreateChild={onCreateChild} />
      ))}
    </div>
  )
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const navigate = useNavigate()

  const reloadNotes = () => api.get<Note[]>('/notes').then(r => setNotes(r.data)).catch(() => {})

  useEffect(() => {
    reloadNotes()
  }, [])

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

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>📝 Notas</h1>
        <button style={styles.newBtn} onClick={() => navigate('/notes/new')}>+ Nova Nota</button>
      </div>
      <div style={styles.tree}>
        {roots.length === 0 && <p style={styles.empty}>Nenhuma nota encontrada.</p>}
        {roots.map(n => (
          <NoteTreeItem
            key={n.id}
            note={n}
            depth={0}
            onSelect={(id) => navigate(`/notes/${id}`)}
            onMove={() => reloadNotes()}
            onCreateChild={(parentId) => navigate('/notes/new', { state: { parentNoteId: parentId } })}
          />
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '2rem', background: '#0f172a', minHeight: '100vh', color: '#f8fafc' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' },
  title: { fontSize: 22, fontWeight: 700 },
  newBtn: { padding: '0.5rem 1.25rem', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600 },
  tree: { background: '#1e293b', borderRadius: 10, padding: '1rem' },
  treeItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.75rem', borderRadius: 8, cursor: 'pointer', marginBottom: 4, background: '#0f172a' },
  expandBtn: { background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', width: 20, fontSize: 10 },
  treeTitle: { flex: 1, fontSize: 14, fontWeight: 500 },
  treeDepth: { fontSize: 11, color: '#475569' },
  addChildBtn: { background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, width: 22, height: 22, cursor: 'pointer' },
  empty: { color: '#475569', textAlign: 'center' },
}
