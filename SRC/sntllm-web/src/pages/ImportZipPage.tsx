import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '../components/AppLayout'
import {
  uploadZip,
  uploadMarkdown,
  convertHtml,
  getImportStatus,
  heartbeatImport,
  executeImport,
  cancelImport,
  type ImportSession,
} from '../api/import'
import api from '../api/client'
import type { Project, Note } from '../types'

type Step = 'upload' | 'analyzing' | 'review' | 'converting' | 'ready' | 'importing' | 'done' | 'error'
const IMPORT_STATE_KEY = 'sntllm:lastImportState'

type PersistedImportState = {
  step: Step
  session: ImportSession | null
  error: string | null
  notesCreated: number
  ollamaUrl: string
  ollamaModel: string
  selectedProjectId: string
  selectedParentNoteId: string
}

const stepFromStatus = (status: ImportSession['status']): Step => {
  switch (status) {
    case 'converting':
      return 'converting'
    case 'importing':
      return 'importing'
    case 'done':
      return 'done'
    case 'error':
      return 'error'
    case 'ready':
      return 'ready'
    default:
      return 'review'
  }
}

const clearPersistedImportState = () => localStorage.removeItem(IMPORT_STATE_KEY)

export default function ImportZipPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [session, setSession] = useState<ImportSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notesCreated, setNotesCreated] = useState(0)

  // Configurações
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [ollamaModel, setOllamaModel] = useState('llama3.2')

  // Destino
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [parentNotes, setParentNotes] = useState<Note[]>([])
  const [selectedParentNoteId, setSelectedParentNoteId] = useState<string>('')
  const [loadingProjects, setLoadingProjects] = useState(false)

  // Seleção de arquivos
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(IMPORT_STATE_KEY)
      if (!raw) return

      const persisted = JSON.parse(raw) as PersistedImportState
      setStep(persisted.step || 'upload')
      setSession(persisted.session || null)
      setError(persisted.error || null)
      setNotesCreated(persisted.notesCreated || 0)
      setOllamaUrl(persisted.ollamaUrl || 'http://localhost:11434')
      setOllamaModel(persisted.ollamaModel || 'llama3.2')
      setSelectedProjectId(persisted.selectedProjectId || '')
      setSelectedParentNoteId(persisted.selectedParentNoteId || '')

      // Se a sessão foi restaurada com status "converting"/"importing",
      // verifica com o backend se ainda está ativa. Se o backend resetou
      // (stale detection), atualiza o step para "review".
      if (persisted.session?.importId && (persisted.step === 'converting' || persisted.step === 'importing')) {
        getImportStatus(persisted.session.importId).then(latest => {
          const newStep = stepFromStatus(latest.status)
          if (newStep !== 'converting' && newStep !== 'importing') {
            setStep(newStep)
            setSession(latest)
            setNotesCreated(latest.notesCreated || 0)
          }
        }).catch(() => {})
      }
    } catch {
      clearPersistedImportState()
    }
  }, [])

  useEffect(() => {
    const data: PersistedImportState = {
      step,
      session,
      error,
      notesCreated,
      ollamaUrl,
      ollamaModel,
      selectedProjectId,
      selectedParentNoteId,
    }
    localStorage.setItem(IMPORT_STATE_KEY, JSON.stringify(data))
  }, [
    step,
    session,
    error,
    notesCreated,
    ollamaUrl,
    ollamaModel,
    selectedProjectId,
    selectedParentNoteId,
  ])

  useEffect(() => {
    if (!session) return

    let isMounted = true
    const syncStatus = async () => {
      try {
        const latest = await getImportStatus(session.importId)
        if (!isMounted) return
        setSession(latest)
        setNotesCreated(latest.notesCreated || 0)
        if (latest.errorMessage) setError(latest.errorMessage)
        setStep((prev) => {
          if (prev === 'review' && latest.status === 'ready') return 'review'
          return stepFromStatus(latest.status)
        })
      } catch {
        // mantém estado local
      }
    }

    void syncStatus()
    const interval = setInterval(() => {
      if (session.status === 'converting' || session.status === 'importing') {
        void syncStatus()
      }
    }, 3000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [session?.importId, session?.status])

  useEffect(() => {
    if (!session) return
    if (session.status === 'done' || session.status === 'error') return

    let isMounted = true
    const beat = async () => {
      try {
        const latest = await heartbeatImport(session.importId)
        if (!isMounted) return
        setSession(latest)
        setNotesCreated(latest.notesCreated || 0)
        if (latest.errorMessage) setError(latest.errorMessage)
      } catch {
        // heartbeat é best-effort
      }
    }

    const interval = setInterval(() => void beat(), 15000)
    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [session?.importId, session?.status])

  // ── Upload ───────────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'md' || ext === 'markdown') {
      setStep('analyzing')
      setError(null)
      setNotesCreated(0)
      setSelectedProjectId('')
      setSelectedParentNoteId('')

      try {
        const result = await uploadMarkdown(file)
        setSession(result)
        setStep('review')
      } catch (err: any) {
        setError(err?.response?.data?.message || err.message || 'Erro ao processar arquivo .md.')
        setStep('error')
      }
      return
    }

    if (!file.name.endsWith('.zip')) {
      setError('Apenas arquivos .zip e .md são aceitos.')
      return
    }

    setStep('analyzing')
    setError(null)
    setNotesCreated(0)
    setSelectedProjectId('')
    setSelectedParentNoteId('')

    try {
      const result = await uploadZip(file, ollamaUrl || undefined, ollamaModel || undefined)
      setSession(result)
      setStep('review')
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Erro ao processar ZIP.')
      setStep('error')
    }
  }, [ollamaUrl, ollamaModel])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  // ── Converter ────────────────────────────────────────────────────────────

  const handleConvert = useCallback(async () => {
    if (!session) return
    setStep('converting')
    setError(null)

    try {
      const result = await convertHtml(session.importId)
      setSession(result)
      setStep(stepFromStatus(result.status))
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Erro ao converter arquivos.')
      setStep('error')
    }
  }, [session])

  // ── Carregar projetos ────────────────────────────────────────────────────

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const { data } = await api.get<Project[]>('/projects')
      setProjects(data.filter(p => !p.isArchived))
    } catch {
      // ignora
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const loadParentNotes = useCallback(async (projectId: string) => {
    if (!projectId) { setParentNotes([]); return }
    try {
      const { data } = await api.get<Note[]>('/notes', { params: { projectId } })
      setParentNotes(data)
    } catch {
      setParentNotes([])
    }
  }, [])

  // ── Executar importação ──────────────────────────────────────────────────

  const handleExecute = useCallback(async () => {
    if (!session) return
    setStep('importing')
    setError(null)

    try {
      const result = await executeImport(
        session.importId,
        selectedProjectId || undefined,
        selectedParentNoteId || undefined,
      )
      setSession(result)
      setNotesCreated(result.notesCreated || 0)
      setStep(stepFromStatus(result.status))
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Erro ao importar notas.')
      setStep('error')
    }
  }, [session, selectedProjectId, selectedParentNoteId])

  // ── Cancelar ─────────────────────────────────────────────────────────────

  const handleCancel = useCallback(async () => {
    if (!session) return
    setCancelling(true)
    try {
      const result = await cancelImport(session.importId)
      setSession(result)
      setStep(stepFromStatus(result.status))
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Erro ao cancelar.')
    } finally {
      setCancelling(false)
    }
  }, [session])

  // ── Seleção de arquivos ──────────────────────────────────────────────────

  const toggleFile = useCallback((path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleAllFiles = useCallback(() => {
    if (!session) return
    setSelectedFiles(prev => {
      if (prev.size === session.files.length) return new Set()
      return new Set(session.files.map(f => f.relativePath))
    })
  }, [session])

  const allSelected = session ? selectedFiles.size === session.files.length && session.files.length > 0 : false

  // ── Helpers de renderização ──────────────────────────────────────────────

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'html': return '🌐'
      case 'md': return '📝'
      case 'image': return '🖼️'
      default: return '📄'
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return { text: 'Pendente', color: '#64748b' }
      case 'converting': return { text: 'Convertendo...', color: '#f59e0b' }
      case 'converted': return { text: '✓ Convertido', color: '#10b981' }
      case 'skipped': return { text: 'Ignorado', color: '#6b7280' }
      case 'error': return { text: '✗ Erro', color: '#ef4444' }
      default: return { text: status, color: '#64748b' }
    }
  }

  const stageLabel = (stage: ImportSession['stage'] | undefined, status: ImportSession['status']) => {
    if (status === 'done') return 'Concluído'
    if (status === 'error') return 'Erro'
    if (!stage) return 'Pronto'
    switch (stage) {
      case 'extract': return 'Extração'
      case 'convert': return 'Conversão HTML → Markdown'
      case 'import': return 'Criando notas'
      case 'finalize': return 'Atualizando links e copiando imagens'
      default: return stage
    }
  }

  // ── Estilos ──────────────────────────────────────────────────────────────

  const styles = {
    container: {
      padding: '32px',
      maxWidth: '900px',
      margin: '0 auto',
      width: '100%',
      overflow: 'auto',
    } as React.CSSProperties,
    title: {
      fontSize: '24px',
      fontWeight: 700,
      marginBottom: '8px',
      color: '#f8fafc',
    } as React.CSSProperties,
    subtitle: {
      fontSize: '14px',
      color: '#94a3b8',
      marginBottom: '24px',
    } as React.CSSProperties,
    dropZone: {
      border: '2px dashed #334155',
      borderRadius: '12px',
      padding: '48px',
      textAlign: 'center' as const,
      cursor: 'pointer',
      background: '#1e293b',
      transition: 'border-color 0.2s',
    } as React.CSSProperties,
    configRow: {
      display: 'flex',
      gap: '12px',
      marginTop: '16px',
      flexWrap: 'wrap' as const,
    } as React.CSSProperties,
    input: {
      flex: 1,
      minWidth: '200px',
      padding: '10px 14px',
      borderRadius: '8px',
      border: '1px solid #334155',
      background: '#0f172a',
      color: '#f8fafc',
      fontSize: '14px',
    } as React.CSSProperties,
    btn: {
      padding: '10px 24px',
      borderRadius: '8px',
      border: 'none',
      fontWeight: 600,
      fontSize: '14px',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
    } as React.CSSProperties,
    btnPrimary: {
      background: '#3b82f6',
      color: '#fff',
    } as React.CSSProperties,
    btnSuccess: {
      background: '#10b981',
      color: '#fff',
    } as React.CSSProperties,
    btnOutline: {
      background: 'transparent',
      border: '1px solid #334155',
      color: '#f8fafc',
    } as React.CSSProperties,
    card: {
      background: '#1e293b',
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '16px',
    } as React.CSSProperties,
    fileList: {
      maxHeight: '400px',
      overflow: 'auto',
      marginTop: '16px',
    } as React.CSSProperties,
    fileItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 12px',
      borderRadius: '6px',
      fontSize: '13px',
      borderBottom: '1px solid #1e293b',
    } as React.CSSProperties,
    progressBar: {
      height: '6px',
      background: '#334155',
      borderRadius: '3px',
      marginTop: '12px',
      overflow: 'hidden',
    } as React.CSSProperties,
    progressFill: {
      height: '100%',
      background: '#3b82f6',
      borderRadius: '3px',
      transition: 'width 0.3s',
    } as React.CSSProperties,
    summaryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: '12px',
      marginBottom: '20px',
    } as React.CSSProperties,
    summaryItem: {
      background: '#0f172a',
      borderRadius: '8px',
      padding: '14px',
      textAlign: 'center' as const,
    } as React.CSSProperties,
    summaryValue: {
      fontSize: '28px',
      fontWeight: 700,
      color: '#f8fafc',
    } as React.CSSProperties,
    summaryLabel: {
      fontSize: '12px',
      color: '#94a3b8',
      marginTop: '4px',
    } as React.CSSProperties,
    select: {
      padding: '10px 14px',
      borderRadius: '8px',
      border: '1px solid #334155',
      background: '#0f172a',
      color: '#f8fafc',
      fontSize: '14px',
      minWidth: '200px',
    } as React.CSSProperties,
    errorBox: {
      background: '#450a0a',
      border: '1px solid #991b1b',
      borderRadius: '8px',
      padding: '16px',
      color: '#fca5a5',
      marginTop: '16px',
    } as React.CSSProperties,
    successBox: {
      background: '#052e16',
      border: '1px solid #166534',
      borderRadius: '8px',
      padding: '24px',
      color: '#86efac',
      textAlign: 'center' as const,
    } as React.CSSProperties,
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const progressPct = session && session.progressTotal > 0
    ? Math.min(100, Math.round((session.progressCurrent / session.progressTotal) * 100))
    : 0

  const eta = (() => {
    if (!session?.startedAt || !session.progressTotal || session.progressCurrent === 0) return null
    const elapsed = Date.now() - new Date(session.startedAt).getTime()
    if (elapsed <= 0) return null
    const rate = session.progressCurrent / (elapsed / 1000) // itens por segundo
    if (rate <= 0) return null
    const remaining = session.progressTotal - session.progressCurrent
    const etaSeconds = remaining / rate
    if (etaSeconds < 1) return 'menos de 1s'
    if (etaSeconds < 60) return `${Math.round(etaSeconds)}s`
    if (etaSeconds < 3600) return `${Math.floor(etaSeconds / 60)}min ${Math.round(etaSeconds % 60)}s`
    return `${Math.floor(etaSeconds / 3600)}h ${Math.floor((etaSeconds % 3600) / 60)}min`
  })()

  return (
    <AppLayout>
      <div style={styles.container}>
        <h1 style={styles.title}>📦 Importar ZIP</h1>
        <p style={styles.subtitle}>
          Importe um arquivo ZIP contendo páginas HTML. Arquivos HTML serão convertidos para
          Markdown via Ollama e importados como notas na hierarquia escolhida.
        </p>

        {/* ── Step: Upload ──────────────────────────────────────────────── */}
        {(step === 'upload' || step === 'analyzing') && (
          <div>
            <div
              style={{
                ...styles.dropZone,
                borderColor: step === 'analyzing' ? '#3b82f6' : '#334155',
                opacity: step === 'analyzing' ? 0.7 : 1,
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {step === 'analyzing' ? (
                <div>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
                  <p style={{ color: '#94a3b8', fontSize: '15px' }}>Analisando arquivo ZIP...</p>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>📁</div>
                  <p style={{ color: '#cbd5e1', fontSize: '16px', fontWeight: 600 }}>
                    Arraste um arquivo .zip ou .md aqui ou clique para selecionar
                  </p>
                  <p style={{ color: '#64748b', fontSize: '13px', marginTop: '8px' }}>
                    Arquivos HTML serão convertidos para Markdown • Arquivos .md importados diretamente • Imagens preservadas
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.md,.markdown"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>

            <div style={styles.configRow}>
              <input
                style={styles.input}
                placeholder="URL do Ollama (ex: http://localhost:11434)"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
              />
              <input
                style={{ ...styles.input, maxWidth: '200px' }}
                placeholder="Modelo (ex: llama3.2)"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── Step: Review / Ready ──────────────────────────────────────── */}
        {(step === 'review' || step === 'ready' || step === 'converting') && session && (
          <div>
            {/* Resumo */}
            <div style={styles.summaryGrid}>
              <div style={styles.summaryItem}>
                <div style={styles.summaryValue}>{session.totalFiles}</div>
                <div style={styles.summaryLabel}>Total de arquivos</div>
              </div>
              <div style={styles.summaryItem}>
                <div style={styles.summaryValue}>{session.htmlFiles}</div>
                <div style={styles.summaryLabel}>Arquivos HTML</div>
              </div>
              <div style={styles.summaryItem}>
                <div style={styles.summaryValue}>{session.imageFiles}</div>
                <div style={styles.summaryLabel}>Imagens</div>
              </div>
              <div style={styles.summaryItem}>
                <div style={styles.summaryValue}>{session.convertedFiles}</div>
                <div style={styles.summaryLabel}>Convertidos</div>
              </div>
            </div>

            {/* Progresso */}
            {(step === 'converting') && (
              <div style={{ ...styles.card, marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', color: '#cbd5e1', fontWeight: 600 }}>
                    {stageLabel(session.stage, session.status)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                    {session.progressCurrent} / {session.progressTotal} ({progressPct}%)
                    {eta && <span style={{ marginLeft: '8px', color: '#64748b' }}>⏱ ETA: {eta}</span>}
                  </div>
                </div>
                <div style={styles.progressBar}>
                  <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            {step === 'converting' && session.progressTotal === 0 && (
              <div style={styles.progressBar}>
                <div style={{ ...styles.progressFill, width: '0%' }} />
              </div>
            )}

            {/* Lista de arquivos */}
            <div style={styles.card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0', margin: 0 }}>
                  Arquivos encontrados ({session.files.length})
                </h3>
                <label style={{ fontSize: '12px', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAllFiles}
                    style={{ cursor: 'pointer' }}
                  />
                  Todos
                </label>
              </div>
              <div style={styles.fileList}>
                {session.files.map((f, i) => {
                  const badge = getStatusBadge(f.status)
                  return (
                    <div key={i} style={{ ...styles.fileItem, flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(f.relativePath)}
                          onChange={() => toggleFile(f.relativePath)}
                          style={{ cursor: 'pointer', flexShrink: 0 }}
                        />
                        <span>{getFileIcon(f.fileType)}</span>
                        <span style={{ flex: 1, color: '#cbd5e1', fontSize: '13px' }}>
                          {f.relativePath}
                        </span>
                        <span style={{
                          fontSize: '11px',
                          color: badge.color,
                          background: `${badge.color}20`,
                          padding: '2px 8px',
                          borderRadius: '4px',
                        }}>
                          {badge.text}
                        </span>
                      </div>
                      {f.status === 'error' && f.errorMessage && (
                        <div style={{
                          fontSize: '11px',
                          color: '#fca5a5',
                          background: '#450a0a',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          marginLeft: '28px',
                          wordBreak: 'break-word',
                          maxWidth: '100%',
                        }}>
                          {f.errorMessage}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Ações */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
              {step === 'review' && session.htmlFiles > 0 && (
                <button
                  style={{ ...styles.btn, ...styles.btnPrimary }}
                  onClick={handleConvert}
                >
                  🔄 Converter HTML → Markdown
                </button>
              )}

              {/* Também mostra o botão quando step='ready' (ex: após reset de sessão stale) */}
              {step === 'ready' && session.htmlFiles > 0 && session.files.some(f => f.fileType === 'html' && f.status === 'pending') && (
                <button
                  style={{ ...styles.btn, ...styles.btnPrimary }}
                  onClick={handleConvert}
                >
                  🔄 Converter HTML → Markdown
                </button>
              )}

              {step === 'converting' && (
                <>
                  <button style={{ ...styles.btn, ...styles.btnPrimary, opacity: 0.6 }} disabled>
                    ⏳ Convertendo via Ollama...
                  </button>
                  <button
                    style={{ ...styles.btn, ...styles.btnOutline, color: '#ef4444', borderColor: '#ef4444' }}
                    onClick={handleCancel}
                    disabled={cancelling}
                  >
                    {cancelling ? '⏳ Cancelando...' : '🛑 Cancelar conversão'}
                  </button>
                </>
              )}

              {(step === 'review' || step === 'ready') && (
                <button
                  style={{ ...styles.btn, ...styles.btnOutline }}
                  onClick={() => {
                    setStep('upload')
                    setSession(null)
                    setError(null)
                    setNotesCreated(0)
                    setSelectedFiles(new Set())
                    clearPersistedImportState()
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>

            {/* Destino da importação */}
            {step === 'ready' && (
              <div style={{ ...styles.card, marginTop: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px', color: '#e2e8f0' }}>
                  📍 Destino da importação
                </h3>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    style={styles.select}
                    value={selectedProjectId}
                    disabled={loadingProjects}
                    onChange={(e) => {
                      setSelectedProjectId(e.target.value)
                      loadParentNotes(e.target.value)
                    }}
                    onFocus={loadProjects}
                  >
                    <option value="">{loadingProjects ? 'Carregando...' : '(Sem projeto)'}</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>

                  <select
                    style={styles.select}
                    value={selectedParentNoteId}
                    onChange={(e) => setSelectedParentNoteId(e.target.value)}
                  >
                    <option value="">(Nota raiz — sem pai)</option>
                    {parentNotes.map(n => (
                      <option key={n.id} value={n.id}>
                        {'— '.repeat(Math.min(n.depth, 5))}{n.title || 'Sem título'}
                      </option>
                    ))}
                  </select>

                  <button
                    style={{ ...styles.btn, ...styles.btnSuccess }}
                    onClick={handleExecute}
                  >
                    🚀 Importar {session.files.filter(f => f.fileType === 'md' || f.fileType === 'html').length} notas
                  </button>
                </div>
                <p style={{ fontSize: '12px', color: '#64748b', marginTop: '12px' }}>
                  As notas serão criadas como sub-notas do nó selecionado. A estrutura de diretórios
                  do ZIP será preservada como hierarquia de notas.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Step: Importing ───────────────────────────────────────────── */}
        {step === 'importing' && (
          <div style={{ ...styles.card, padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{ fontSize: '32px' }}>📝</div>
              <div>
                <div style={{ color: '#cbd5e1', fontSize: '15px', fontWeight: 600 }}>
                  {stageLabel(session?.stage, session?.status || 'importing')}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '12px' }}>
                  {session?.progressCurrent ?? 0} / {session?.progressTotal ?? 0} ({progressPct}%)
                  {eta && <span style={{ marginLeft: '8px', color: '#64748b' }}>⏱ ETA: {eta}</span>}
                </div>
              </div>
            </div>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
            </div>
            <div style={{ marginTop: '16px' }}>
              <button
                style={{ ...styles.btn, ...styles.btnOutline, color: '#ef4444', borderColor: '#ef4444' }}
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? '⏳ Cancelando...' : '🛑 Cancelar importação'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Done ────────────────────────────────────────────────── */}
        {step === 'done' && (
          <div>
            <div style={styles.successBox}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
              <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Importação concluída!</h2>
              <p style={{ fontSize: '15px' }}>
                {notesCreated} nota{notesCreated !== 1 ? 's' : ''} criada{notesCreated !== 1 ? 's' : ''} com sucesso.
              </p>
              <p style={{ fontSize: '13px', color: '#6ee7b7', marginTop: '8px' }}>
                Todos os links internos foram atualizados para apontar para as novas notas.
              </p>
              <div style={{ marginTop: '20px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button
                  style={{ ...styles.btn, ...styles.btnPrimary }}
                  onClick={() => navigate('/notes')}
                >
                  📋 Ver notas
                </button>
                <button
                  style={{ ...styles.btn, ...styles.btnOutline }}
                  onClick={() => {
                    setStep('upload')
                    setSession(null)
                    setError(null)
                    setNotesCreated(0)
                    clearPersistedImportState()
                  }}
                >
                  🔄 Nova importação
                </button>
              </div>
            </div>

            {session && (
              <div style={{ ...styles.card, marginTop: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>
                  Arquivos importados
                </h3>
                <div style={styles.fileList}>
                  {session.files
                    .filter(f => f.importedNoteId)
                    .map((f, i) => (
                      <div key={i} style={styles.fileItem}>
                        <span>{getFileIcon(f.fileType)}</span>
                        <span style={{ flex: 1, color: '#cbd5e1', fontSize: '13px' }}>
                          {f.relativePath}
                        </span>
                        <button
                          style={{
                            ...styles.btn,
                            ...styles.btnOutline,
                            padding: '4px 12px',
                            fontSize: '12px',
                          }}
                          onClick={() => navigate(`/notes/${f.importedNoteId}`)}
                        >
                          Abrir nota →
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step: Error ───────────────────────────────────────────────── */}
        {step === 'error' && error && (
          <div style={styles.errorBox}>
            <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>❌ Erro na importação</h3>
            <p style={{ fontSize: '14px' }}>{error}</p>
            <button
              style={{ ...styles.btn, ...styles.btnOutline, marginTop: '16px' }}
              onClick={() => {
                setStep('upload')
                setSession(null)
                setError(null)
                setNotesCreated(0)
                clearPersistedImportState()
              }}
            >
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
