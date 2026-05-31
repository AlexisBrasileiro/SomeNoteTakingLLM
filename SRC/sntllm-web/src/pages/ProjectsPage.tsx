import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import type { Project } from '../types'

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  async function load() {
    const r = await api.get<Project[]>('/projects')
    setProjects(r.data)
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      await api.post('/projects', { name, description: desc || null })
      setName('')
      setDesc('')
      load()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/')}>← Dashboard</button>
        <h1 style={styles.title}>Projetos</h1>
      </div>

      <form onSubmit={handleCreate} style={styles.form}>
        <input style={styles.input} placeholder="Nome do projeto" value={name} onChange={e => setName(e.target.value)} required />
        <input style={styles.input} placeholder="Descrição (opcional)" value={desc} onChange={e => setDesc(e.target.value)} />
        <button type="submit" disabled={creating} style={styles.createBtn}>
          {creating ? 'Criando...' : 'Criar Projeto'}
        </button>
      </form>

      <div style={styles.list}>
        {projects.map(p => (
          <div key={p.id} style={styles.projectCard}>
            <div>
              <h3 style={styles.projectName}>{p.name}</h3>
              {p.description && <p style={styles.projectDesc}>{p.description}</p>}
            </div>
            <button style={styles.viewBtn} onClick={() => navigate(`/notes?projectId=${p.id}`)}>Ver notas →</button>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '2rem', background: '#0f172a', minHeight: '100vh', color: '#f8fafc' },
  header: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: '2rem' },
  backBtn: { background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  form: { display: 'flex', gap: 10, marginBottom: '2rem', flexWrap: 'wrap' },
  input: { padding: '0.6rem 1rem', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f8fafc', fontSize: 14, flex: 1, minWidth: 200 },
  createBtn: { padding: '0.6rem 1.25rem', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  projectCard: { background: '#1e293b', borderRadius: 10, padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #334155' },
  projectName: { fontSize: 15, fontWeight: 600, margin: 0 },
  projectDesc: { fontSize: 13, color: '#94a3b8', margin: '4px 0 0' },
  viewBtn: { background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#6366f1', cursor: 'pointer', padding: '0.4rem 0.75rem', fontSize: 13 },
}
