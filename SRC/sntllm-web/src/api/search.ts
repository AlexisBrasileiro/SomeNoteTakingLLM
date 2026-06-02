import api from './client'

export type SearchQuery = {
  query: string;
  category?: 'all' | 'tags' | 'dates' | 'projects';
}

export type SearchResult = {
  id: string;
  title: string;
  type: 'note' | 'project' | 'tag';
  createdAt?: string;
}

export async function searchNotes(query: string, category?: SearchQuery['category']): Promise<SearchResult[]> {
  const params: Record<string, any> = { query: query }
  if (category) {
    params.category = category
  }
  const response = await api.get(`/search/notes`, { params })
  return response.data
}

export async function searchProjects(query: string): Promise<SearchResult[]> {
  const response = await api.get(`/search/projects?query=${query}`)
  return response.data
}

export async function searchTags(query: string): Promise<SearchResult[]> {
  const response = await api.get(`/search/tags?query=${query}`)
  return response.data
}