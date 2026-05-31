import { useState, useEffect } from 'react'
import api from '../api/client'

interface PaperlessDocument {
  id: number
  title: string
  original_file_name?: string
  created: string
  added: string
  tags?: number[]
  downloadUrl?: string
}

interface DocumentQueryResult {
  strategy: string
  strategyLabel: string
  documents: PaperlessDocument[]
}

interface Props {
  projectId: string | null
  projectName?: string
}

export default function PaperlessDocumentsPanel({ projectId, projectName }: Props) {
  const [results, setResults] = useState<DocumentQueryResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) {
      setResults([])
      return
    }
    setLoading(true)
    setError('')
    setResults([])
    setExpandedStrategy(null)

    api.get<DocumentQueryResult[]>(`/paperless/documents?projectId=${projectId}`)
      .then(r => {
        setResults(r.data)
        // Auto-expand first strategy that has results
        const first = r.data.find(s => s.documents.length > 0)
        if (first) setExpandedStrategy(first.strategy)
      })
      .catch(err => {
        const msg = err?.response?.data?.message ?? 'Erro ao consultar Paperless-ng.'
        setError(msg)
      })
      .finally(() => setLoading(false))
  }, [projectId])

  if (!projectId) return null

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.title}>📄 Documentos Paperless-ng</span>
        {projectName && <span style={s.sub}>{projectName}</span>}
      </div>

      {loading && <p style={s.hint}>Consultando Paperless-ng...</p>}
      {error && <p style={s.error}>{error}</p>}

      {!loading && results.length === 0 && !error && (
        <p style={s.hint}>Nenhum resultado. Verifique a configuração do Paperless-ng em Configurações.</p>
      )}

      {results.map(result => (
        <div key={result.strategy} style={s.strategyBlock}>
          <button
            style={s.strategyBtn}
            onClick={() => setExpandedStrategy(expandedStrategy === result.strategy ? null : result.strategy)}
          >
            <span>{expandedStrategy === result.strategy ? '▼' : '▶'}</span>
            <span style={{ flex: 1, textAlign: 'left' }}>{result.strategyLabel}</span>
            <span style={s.badge}>{result.documents.length}</span>
          </button>

          {expandedStrategy === result.strategy && (
            <div style={s.docList}>
              {result.documents.length === 0 ? (
                <p style={{ ...s.hint, margin: '8px 12px' }}>Nenhum documento nesta estratégia.</p>
              ) : (
                result.documents.map(doc => (
                  <div key={doc.id} style={s.docRow}>
                    <div style={s.docInfo}>
                      <span style={s.docTitle}>{doc.title || doc.original_file_name || `Documento #${doc.id}`}</span>
                      <span style={s.docDate}>{new Date(doc.created).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div style={s.docActions}>
                      {doc.downloadUrl && (
                        <a href={doc.downloadUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
                          ⬇️
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  sub: {
    fontSize: 12,
    color: 'var(--text-muted)',
  },
  hint: {
    fontSize: 12,
    color: 'var(--text-muted)',
    padding: '12px 16px',
    margin: 0,
  },
  error: {
    fontSize: 12,
    color: 'var(--danger)',
    padding: '12px 16px',
    margin: 0,
  },
  strategyBlock: {
    borderBottom: '1px solid var(--border)',
  },
  strategyBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    background: 'none',
    border: 'none',
    padding: '10px 16px',
    cursor: 'pointer',
    fontSize: 13,
    color: 'var(--text-secondary)',
    fontWeight: 600,
  },
  badge: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    borderRadius: 10,
    padding: '1px 8px',
    fontSize: 11,
    minWidth: 24,
    textAlign: 'center',
  },
  docList: {
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-primary)',
  },
  docRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    borderBottom: '1px solid var(--border)',
    gap: 8,
  },
  docInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  docTitle: {
    fontSize: 13,
    color: 'var(--text-primary)',
    fontWeight: 500,
  },
  docDate: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  docActions: {
    display: 'flex',
    gap: 6,
  },
  link: {
    fontSize: 16,
    textDecoration: 'none',
  },
}
