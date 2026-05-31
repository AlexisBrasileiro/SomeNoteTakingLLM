import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import type { Note } from '../types'

function NoteTreeItem({ note, depth, onSelect }: { note: Note & { children?: Note[] }, depth: number, onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div style={styles.treeItem} onClick={() => onSelect(note.id)}>
        {note.children && note.children.length > 0 && (
          <button style={styles.expandBtn} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}>
            {expanded ? '▼' : '▶'}
          </button>
        )}
        <span style={styles.treeTitle}>{note.title || 'Sem título'}</span>
        <span style={styles.treeDepth}>nível {note.depth}</span>
      </div>
      {expanded && note.children?.map(child => (
        <NoteTreeItem key={child.id} note={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  )
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    api.get<Note[]>('/notes').then(r => setNotes(r.data))
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
          <NoteTreeItem key={n.id} note={n} depth={0} onSelect={(id) => navigate(`/notes/${id}`)} />
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
  empty: { color: '#475569', textAlign: 'center' },
}
