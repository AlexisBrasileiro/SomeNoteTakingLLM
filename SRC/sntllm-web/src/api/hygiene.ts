import api from './client'

export interface DeletePreviewItem {
  id: string
  title: string | null
  depth: number
  childCount: number
}

export interface DeletePreviewResponse {
  items: DeletePreviewItem[]
  totalCount: number
}

export async function getDeletePreview(noteIds: string[]): Promise<DeletePreviewResponse> {
  const { data } = await api.post<DeletePreviewResponse>('/notes/delete-preview', { noteIds })
  return data
}

export async function deleteRecursive(noteIds: string[]): Promise<{ deleted: number }> {
  const { data } = await api.post<{ deleted: number }>('/notes/delete-recursive', { noteIds })
  return data
}

export async function batchMove(noteIds: string[], projectId?: string, parentNoteId?: string): Promise<{ moved: number }> {
  const { data } = await api.post<{ moved: number }>('/notes/batch-move', {
    noteIds,
    projectId: projectId || null,
    parentNoteId: parentNoteId || null,
  })
  return data
}

export async function batchTag(noteIds: string[], tags: string[]): Promise<{ tagged: number }> {
  const { data } = await api.post<{ tagged: number }>('/notes/batch-tag', { noteIds, tags })
  return data
}
