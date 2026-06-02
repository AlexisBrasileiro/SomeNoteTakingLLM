import { useSearch } from './SearchContext'

export function SearchResults() {
  const { searchState } = useSearch()
  const { query, results, isLoading, error } = searchState

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: '20px', color: '#6366f1' }}>Buscando resultados...</div>
  }

  if (error) {
    return <div style={{ textAlign: 'center', padding: '20px', color: 'red' }}>Erro: {error}</div>
  }

  if (results.length === 0 && query.length > 0) {
    return <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>Nenhum resultado encontrado para "{query}"</div>
  }

  if (results.length === 0 && query.length === 0) {
    return <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>Digite algo para começar a pesquisar.</div>
  }

  return (
    <div style={{ padding: '20px', background: '#1e293b', borderRadius: '10px', marginTop: '20px' }}>
      <h2 style={{ color: '#fff', marginBottom: '15px' }}>Resultados para "{query}"</h2>

      {/* Categorias de Resultados */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <div style={{ flex: 1, border: '1px solid #334155', borderRadius: '8px', padding: '10px' }}>
          <h3 style={{ color: '#6366f1', borderBottom: '1px solid #334155', marginBottom: '10px' }}>Tags ({results.filter(r => r.type === 'tag').length})</h3>
          {/* Renderizar Tags aqui */}
          {results.filter(r => r.type === 'tag').map(r => (
            <div key={r.id} style={{ padding: '5px 0', borderBottom: '1px dotted #334155' }}>{r.title}</div>
          ))}
        </div>
        <div style={{ flex: 1, border: '1px solid #334155', borderRadius: '8px', padding: '10px' }}>
          <h3 style={{ color: '#6366f1', borderBottom: '1px solid #334155', marginBottom: '10px' }}>Projetos ({results.filter(r => r.type === 'project').length})</h3>
          {/* Renderizar Projetos aqui */}
          {results.filter(r => r.type === 'project').map(r => (
            <div key={r.id} style={{ padding: '5px 0', borderBottom: '1px dotted #334155' }}>{r.title}</div>
          ))}
        </div>
        <div style={{ flex: 1, border: '1px solid #334155', borderRadius: '8px', padding: '10px' }}>
          <h3 style={{ color: '#6366f1', borderBottom: '1px solid #334155', marginBottom: '10px' }}>Notas ({results.filter(r => r.type === 'note').length})</h3>
          {/* Renderizar Notas aqui */}
          {results.filter(r => r.type === 'note').map(r => (
            <div key={r.id} style={{ padding: '5px 0', borderBottom: '1px dotted #334155' }}>{r.title}</div>
          ))}
        </div>
      </div>

      {/* Lista detalhada (opcional, pode ser expandida) */}
      <div style={{ marginTop: '20px' }}>
        <h3 style={{ color: '#6366f1' }}>Detalhes</h3>
        {/* Aqui você pode adicionar uma lista mais detalhada se desejar */}
      </div>
    </div>
  )
}