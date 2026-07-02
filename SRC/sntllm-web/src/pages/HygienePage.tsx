import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '../components/AppLayout'
import api from '../api/client'
import { getDeletePreview, deleteRecursive, batchMove, batchTag, type DeletePreviewItem } from '../api/hygiene'
import type { Note, Project } from '../types'

export default function HygienePage() {
  const navigate = useNavigate()

  const [notes, setNotes] = useState<Note[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('')

  // Ações
  const [action, setAction] = useState<'move' | 'tag' | 'delete' | null>(null)
  const [targetProjectId, setTargetProjectId] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])

  // Delete preview
  const [deletePreview, setDeletePreview] = useState<DeletePreviewItem[]>([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [notesRes, projectsRes] = await Promise.all([
          api.get<Note[]>('/notes'),
          api.get<Project[]>('/projects'),
        ])
        setNotes(notesRes.data)
        setProjects(projectsRes.data.filter(p => !p.isArchived))
      } catch {
        setMessage({ type: 'error', text: 'Erro ao carregar dados.' })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filteredNotes = notes.filter(n => {
    if (search && !(n.title ?? '').toLowerCase().includes(search.toLowerCase())) return false
    if (projectFilter && n.projectId !== projectFilter) return false
    return true
  })

  const toggleNote = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === filteredNotes.length) return new Set()
      return new Set(filteredNotes.map(n => n.id))
    })
  }, [filteredNotes])

  const clearSelection = () => {
    setSelectedIds(new Set())
    setAction(null)
    setDeletePreview([])
    setShowDeleteConfirm(false)
    setMessage(null)
  }

  // ── Delete flow ──────────────────────────────────────────────────────────

  const handleDeleteClick = async () => {
    if (selectedIds.size === 0) return
    setActionLoading(true)
    try {
      const preview = await getDeletePreview([...selectedIds])
      setDeletePreview(preview.items)
      setShowDeleteConfirm(true)
    } catch {
      setMessage({ type: 'error', text: 'Erro ao carregar preview de exclusão.' })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    try {
      const result = await deleteRecursive([...selectedIds])
      setMessage({ type: 'success', text: `${result.deleted} nota(s) excluída(s).` })
      setNotes(prev => prev.filter(n => !selectedIds.has(n.id)))
      clearSelection()
    } catch {
      setMessage({ type: 'error', text: 'Erro ao excluir notas.' })
    } finally {
      setDeleting(false)
    }
  }

  // ── Move ──────────────────────────────────────────────────────────────────

  const handleMove = async () => {
    if (selectedIds.size === 0) return
    setActionLoading(true)
    try {
      const result = await batchMove(
        [...selectedIds],
        targetProjectId || undefined,
        undefined,
      )
      setMessage({ type: 'success', text: `${result.moved} nota(s) movida(s).` })
      clearSelection()
      // Recarrega
      const { data } = await api.get<Note[]>('/notes')
      setNotes(data)
    } catch {
      setMessage({ type: 'error', text: 'Erro ao mover notas.' })
    } finally {
      setActionLoading(false)
    }
  }

  // ── Tag ───────────────────────────────────────────────────────────────────

  const addTag = () => {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) {
      setTags(prev => [...prev, t])
      setTagInput('')
    }
  }

  const removeTag = (t: string) => setTags(prev => prev.filter(x => x !== t))

  const handleTag = async () => {
    if (selectedIds.size === 0) return
    setActionLoading(true)
    try {
      const result = await batchTag([...selectedIds], tags)
      setMessage({ type: 'success', text: `${result.tagged} nota(s) atualizada(s).` })
      clearSelection()
      setTags([])
      const { data } = await api.get<Note[]>('/notes')
      setNotes(data)
    } catch {
      setMessage({ type: 'error', text: 'Erro ao atualizar tags.' })
    } finally {
      setActionLoading(false)
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const styles = {
    container: { padding: '24px 32px', maxWidth: '1100px', margin: '0 auto', width: '100%', overflow: 'auto' } as React.CSSProperties,
    title: { fontSize: '22px', fontWeight: 700, color: '#f8fafc', marginBottom: '4px' } as React.CSSProperties,
    subtitle: { fontSize: '13px', color: '#94a3b8', marginBottom: '20px' } as React.CSSProperties,
    toolbar: { display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' as const, alignItems: 'center' } as React.CSSProperties,
    input: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #334155', background: '#0f172a', color: '#f8fafc', fontSize: '13px', minWidth: '180px' } as React.CSSProperties,
    select: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #334155', background: '#0f172a', color: '#f8fafc', fontSize: '13px' } as React.CSSProperties,
    btn: { padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
    btnPrimary: { background: '#3b82f6', color: '#fff' } as React.CSSProperties,
    btnDanger: { background: '#dc2626', color: '#fff' } as React.CSSProperties,
    btnOutline: { background: 'transparent', border: '1px solid #334155', color: '#f8fafc' } as React.CSSProperties,
    card: { background: '#1e293b', borderRadius: '10px', padding: '16px', marginBottom: '12px' } as React.CSSProperties,
    noteList: { maxHeight: '60vh', overflow: 'auto' } as React.CSSProperties,
    noteItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', borderBottom: '1px solid #1e293b', cursor: 'pointer' } as React.CSSProperties,
    tag: { fontSize: '11px', background: '#334155', color: '#cbd5e1', padding: '2px 8px', borderRadius: '4px' } as React.CSSProperties,
    messageBox: (type: 'success' | 'error') => ({
      padding: '12px 16px',
      borderRadius: '8px',
      marginBottom: '12px',
      fontSize: '13px',
      background: type === 'success' ? '#052e16' : '#450a0a',
      border: `1px solid ${type === 'success' ? '#166534' : '#991b1b'}`,
      color: type === 'success' ? '#86efac' : '#fca5a5',
    } as React.CSSProperties),
    modal: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 } as React.CSSProperties,
    modalContent: { background: '#1e293b', borderRadius: '12px', padding: '24px', maxWidth: '500px', width: '90%', maxHeight: '70vh', overflow: 'auto' } as React.CSSProperties,
  }

  if (loading) {
    return (
      <AppLayout>
        <div style={styles.container}>
          <p style={{ color: '#94a3b8' }}>Carregando...</p>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div style={styles.container}>
        <h1 style={styles.title}>🧹 Higienização de Notas</h1>
        <p style={styles.subtitle}>
          Selecione notas para mover, adicionar tags ou excluir em lote.
        </p>

        {message && (
          <div style={styles.messageBox(message.type)}>
            {message.text}
            <button
              style={{ ...styles.btn, ...styles.btnOutline, marginLeft: '12px', padding: '4px 10px', fontSize: '11px' }}
              onClick={() => setMessage(null)}
            >
              Fechar
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div style={styles.toolbar}>
          <input
            style={styles.input}
            placeholder="🔍 Buscar notas..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            style={styles.select}
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
          >
            <option value="">Todos os projetos</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span style={{ fontSize: '12px', color: '#64748b', marginLeft: 'auto' }}>
            {selectedIds.size} selecionada(s)
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ ...styles.toolbar, marginBottom: '20px' }}>
          <button
            style={{ ...styles.btn, ...(action === 'move' ? styles.btnPrimary : styles.btnOutline) }}
            onClick={() => { setAction('move'); setShowDeleteConfirm(false) }}
            disabled={selectedIds.size === 0}
          >
            📁 Mover
          </button>
          <button
            style={{ ...styles.btn, ...(action === 'tag' ? styles.btnPrimary : styles.btnOutline) }}
            onClick={() => { setAction('tag'); setShowDeleteConfirm(false) }}
            disabled={selectedIds.size === 0}
          >
            🏷️ Tags
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnDanger }}
            onClick={handleDeleteClick}
            disabled={selectedIds.size === 0 || actionLoading}
          >
            {actionLoading ? '⏳' : '🗑️'} Excluir
          </button>
          {selectedIds.size > 0 && (
            <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={clearSelection}>
              Limpar seleção
            </button>
          )}
        </div>

        {/* Move panel */}
        {action === 'move' && (
          <div style={styles.card}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginBottom: '10px' }}>Mover {selectedIds.size} nota(s)</h3>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select style={styles.select} value={targetProjectId} onChange={e => setTargetProjectId(e.target.value)}>
                <option value="">(Sem projeto)</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                style={{ ...styles.btn, ...styles.btnPrimary }}
                onClick={handleMove}
                disabled={actionLoading}
              >
                {actionLoading ? '⏳ Movendo...' : '✅ Confirmar movimentação'}
              </button>
            </div>
          </div>
        )}

        {/* Tag panel */}
        {action === 'tag' && (
          <div style={styles.card}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginBottom: '10px' }}>Tags para {selectedIds.size} nota(s)</h3>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
              {tags.map(t => (
                <span key={t} style={{ ...styles.tag, cursor: 'pointer' }} onClick={() => removeTag(t)}>
                  {t} ✕
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={styles.input}
                placeholder="Nova tag..."
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTag() }}
              />
              <button style={{ ...styles.btn, ...styles.btnOutline }} onClick={addTag}>+ Adicionar</button>
              <button
                style={{ ...styles.btn, ...styles.btnPrimary }}
                onClick={handleTag}
                disabled={actionLoading}
              >
                {actionLoading ? '⏳ Aplicando...' : '✅ Aplicar tags'}
              </button>
            </div>
          </div>
        )}

        {/* Note list */}
        <div style={styles.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <label style={{ fontSize: '12px', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input type="checkbox" checked={selectedIds.size === filteredNotes.length && filteredNotes.length > 0} onChange={toggleAll} />
              Todos ({filteredNotes.length})
            </label>
          </div>
          <div style={styles.noteList}>
            {filteredNotes.map(n => (
              <div
                key={n.id}
                style={{ ...styles.noteItem, background: selectedIds.has(n.id) ? '#1e3a5f' : 'transparent' }}
                onClick={() => toggleNote(n.id)}
              >
                <input type="checkbox" checked={selectedIds.has(n.id)} onChange={() => toggleNote(n.id)} style={{ cursor: 'pointer' }} />
                <span style={{ color: '#64748b', fontSize: '11px', minWidth: '24px' }}>
                  {'— '.repeat(Math.min(n.depth, 8))}
                </span>
                <span style={{ flex: 1, color: '#cbd5e1' }}>{n.title || '(sem título)'}</span>
                {n.directTags?.map(t => (
                  <span key={t} style={styles.tag}>{t}</span>
                ))}
                <button
                  style={{ ...styles.btn, ...styles.btnOutline, padding: '4px 10px', fontSize: '11px' }}
                  onClick={e => { e.stopPropagation(); navigate(`/notes/${n.id}`) }}
                >
                  Abrir
                </button>
              </div>
            ))}
            {filteredNotes.length === 0 && (
              <p style={{ color: '#64748b', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
                Nenhuma nota encontrada.
              </p>
            )}
          </div>
        </div>

        {/* Delete confirmation modal */}
        {showDeleteConfirm && (
          <div style={styles.modal} onClick={() => setShowDeleteConfirm(false)}>
            <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fca5a5', marginBottom: '8px' }}>
                ⚠️ Confirmar exclusão
              </h3>
              <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
                As seguintes {deletePreview.length} nota(s) serão excluídas permanentemente
                (incluindo todas as sub-notas):
              </p>
              <div style={{ maxHeight: '300px', overflow: 'auto', marginBottom: '16px' }}>
                {deletePreview.map(item => (
                  <div key={item.id} style={{ padding: '6px 0', borderBottom: '1px solid #1e293b', fontSize: '13px', color: '#cbd5e1' }}>
                    <span style={{ color: '#64748b' }}>{'— '.repeat(Math.min(item.depth, 8))}</span>
                    {item.title || '(sem título)'}
                    {item.childCount > 0 && (
                      <span style={{ color: '#f59e0b', fontSize: '11px', marginLeft: '8px' }}>
                        +{item.childCount} sub-nota(s)
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  style={{ ...styles.btn, ...styles.btnOutline }}
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancelar
                </button>
                <button
                  style={{ ...styles.btn, ...styles.btnDanger }}
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                >
                  {deleting ? '⏳ Excluindo...' : '🗑️ Confirmar exclusão'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
