import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import AppLayout from '../components/AppLayout'
import type { Project, Note } from '../types'

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [recentNotes, setRecentNotes] = useState<Note[]>([])

  useEffect(() => {
    api.get<Project[]>('/projects').then(r => setProjects(r.data))
    api.get<Note[]>('/notes').then(r => setRecentNotes(r.data.slice(0, 5)))
  }, [])

  return (
    <AppLayout>
      <div style={styles.main}>
        <h1 style={styles.heading}>Bem-vindo, {user?.userName} 👋</h1>

        <section>
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>Projetos</h2>
            <button style={styles.createBtn} onClick={() => navigate('/projects/new')}>+ Novo Projeto</button>
          </div>
          <div style={styles.grid}>
            {projects.length === 0 && <p style={styles.empty}>Nenhum projeto ainda.</p>}
            {projects.map(p => (
              <div key={p.id} style={styles.card} onClick={() => navigate(`/projects/${p.id}`)}>
                <h3 style={styles.cardTitle}>{p.name}</h3>
                {p.description && <p style={styles.cardDesc}>{p.description}</p>}
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginTop: '2rem' }}>
          <h2 style={styles.sectionTitle}>Notas Recentes</h2>
          <div style={styles.noteList}>
            {recentNotes.length === 0 && <p style={styles.empty}>Nenhuma nota ainda.</p>}
            {recentNotes.map(n => (
              <div key={n.id} style={styles.noteItem} onClick={() => navigate(`/notes/${n.id}`)}>
                <span style={styles.noteTitle}>{n.title || 'Sem título'}</span>
                <span style={styles.noteDate}>{n.noteDate ? new Date(n.noteDate).toLocaleDateString('pt-BR') : ''}</span>
              </div>
            ))}
          </div>
          <button style={styles.viewAllBtn} onClick={() => navigate('/notes/new')}>+ Nova nota →</button>
        </section>
      </div>
    </AppLayout>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: { flex: 1, padding: '2rem 2.5rem', overflowY: 'auto' },
  heading: { fontSize: 24, fontWeight: 700, marginBottom: '2rem' },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  sectionTitle: { fontSize: 18, fontWeight: 600, color: '#e2e8f0' },
  createBtn: { padding: '0.5rem 1rem', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' },
  card: { background: '#1e293b', borderRadius: 10, padding: '1.25rem', cursor: 'pointer', border: '1px solid #334155' },
  cardTitle: { fontSize: 15, fontWeight: 600, marginBottom: 6 },
  cardDesc: { fontSize: 13, color: '#94a3b8', margin: 0 },
  noteList: { display: 'flex', flexDirection: 'column', gap: 6 },
  noteItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: '#1e293b', borderRadius: 8, cursor: 'pointer', border: '1px solid #334155' },
  noteTitle: { fontSize: 14, fontWeight: 500 },
  noteDate: { fontSize: 12, color: '#64748b' },
  empty: { color: '#475569', fontSize: 14 },
  viewAllBtn: { marginTop: '1rem', background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 14, fontWeight: 500 },
}
