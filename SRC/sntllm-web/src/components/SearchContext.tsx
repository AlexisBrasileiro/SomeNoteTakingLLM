import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { SearchQuery, SearchResult } from '../types'

interface SearchContextValue {
  searchState: {
    query: string;
    results: SearchResult[];
    isLoading: boolean;
    error: string | null;
  };
  searchNotes: (query: string, category?: SearchQuery['category']) => Promise<SearchResult[]>;
  searchProjects: (query: string) => Promise<SearchResult[]>;
  searchTags: (query: string) => Promise<SearchResult[]>;
  searchAll: (query: string) => Promise<SearchResult[]>;
  clearSearch: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null)

export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchState, setSearchState] = useState<{ query: string; results: SearchResult[]; isLoading: boolean; error: string | null }>({
    query: '',
    results: [],
    isLoading: false,
    error: null,
  })

  const searchNotes = useCallback(async (query: string, category?: SearchQuery['category']): Promise<SearchResult[]> => {
    setSearchState(prev => ({ ...prev, isLoading: true, error: null }))
    try {
      const results = await import('../api/search').then(mod => mod.searchNotes(query, category))
      setSearchState({ query: query, results: results, isLoading: false, error: null })
      return results
    } catch (error: any) {
      setSearchState({ query: query, results: [], isLoading: false, error: error.message || 'Erro na busca de notas' })
      return []
    }
  }, [])

  const searchProjects = useCallback(async (query: string): Promise<SearchResult[]> => {
    setSearchState(prev => ({ ...prev, isLoading: true, error: null }))
    try {
      const results = await import('../api/search').then(mod => mod.searchProjects(query))
      setSearchState({ query: query, results: results, isLoading: false, error: null })
      return results
    } catch (error: any) {
      setSearchState({ query: query, results: [], isLoading: false, error: error.message || 'Erro na busca de projetos' })
      return []
    }
  }, [])

  const searchTags = useCallback(async (query: string): Promise<SearchResult[]> => {
    setSearchState(prev => ({ ...prev, isLoading: true, error: null }))
    try {
      const results = await import('../api/search').then(mod => mod.searchTags(query))
      setSearchState({ query: query, results: results, isLoading: false, error: null })
      return results
    } catch (error: any) {
      setSearchState({ query: query, results: [], isLoading: false, error: error.message || 'Erro na busca de tags' })
      return []
    }
  }, [])

  const searchAll = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) {
      setSearchState({ query: '', results: [], isLoading: false, error: null })
      return []
    }

    setSearchState(prev => ({ ...prev, query, isLoading: true, error: null }))
    try {
      const api = await import('../api/search')
      const [notes, projects, tags] = await Promise.all([
        api.searchNotes(query, 'all'),
        api.searchProjects(query),
        api.searchTags(query),
      ])
      const combined = [...notes, ...projects, ...tags]
      setSearchState({ query, results: combined, isLoading: false, error: null })
      return combined
    } catch (error: any) {
      setSearchState({ query, results: [], isLoading: false, error: error.message || 'Erro na busca' })
      return []
    }
  }, [])

  const clearSearch = useCallback(() => {
    setSearchState({ query: '', results: [], isLoading: false, error: null })
  }, [])

  return (
    <SearchContext.Provider value={{ searchState, searchNotes, searchProjects, searchTags, searchAll, clearSearch }}>
      {children}
    </SearchContext.Provider>
  )
}

export function useSearch() {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearch must be used inside SearchProvider')
  return ctx
}