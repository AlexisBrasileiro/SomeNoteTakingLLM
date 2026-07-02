import api from './client'

export interface ImportFileEntry {
  relativePath: string
  fileType: 'html' | 'md' | 'image' | 'other'
  status: 'pending' | 'converting' | 'converted' | 'skipped' | 'error'
  importedNoteId?: string
  importedNoteTitle?: string
  errorMessage?: string
}

export type ImportStage = 'extract' | 'convert' | 'import' | 'finalize'

export interface ImportSession {
  importId: string
  status: 'extracting' | 'converting' | 'ready' | 'importing' | 'done' | 'error'
  stage: ImportStage
  progressCurrent: number
  progressTotal: number
  totalFiles: number
  htmlFiles: number
  convertedFiles: number
  imageFiles: number
  notesCreated: number
  files: ImportFileEntry[]
  errorMessage?: string
  startedAt?: string
  lastHeartbeatUtc: string
  lastUpdatedUtc: string
}

export interface ImportResult {
  importId: string
  status: 'done' | 'error'
  notesCreated: number
  files: ImportFileEntry[]
}

export async function uploadZip(
  file: File,
  ollamaUrl?: string,
  ollamaModel?: string,
): Promise<ImportSession> {
  const form = new FormData()
  form.append('file', file)
  if (ollamaUrl) form.append('ollamaUrl', ollamaUrl)
  if (ollamaModel) form.append('ollamaModel', ollamaModel)

  const { data } = await api.post<ImportSession>('/import/zip', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000,
  })
  return data
}

export async function convertHtml(importId: string): Promise<ImportSession> {
  const { data } = await api.post<ImportSession>(`/import/${importId}/convert`)
  return data
}

export async function getImportStatus(importId: string): Promise<ImportSession> {
  const { data } = await api.get<ImportSession>(`/import/${importId}`)
  return data
}

export async function heartbeatImport(importId: string): Promise<ImportSession> {
  const { data } = await api.post<ImportSession>(`/import/${importId}/heartbeat`)
  return data
}

export async function executeImport(
  importId: string,
  projectId?: string,
  parentNoteId?: string,
): Promise<ImportSession> {
  const { data } = await api.post<ImportSession>(`/import/${importId}/execute`, {
    projectId: projectId || null,
    parentNoteId: parentNoteId || null,
  })
  return data
}

export async function cancelImport(importId: string): Promise<ImportSession> {
  const { data } = await api.post<ImportSession>(`/import/${importId}/cancel`)
  return data
}

export async function uploadMarkdown(
  file: File,
): Promise<ImportSession> {
  const form = new FormData()
  form.append('file', file)

  const { data } = await api.post<ImportSession>('/import/md', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30_000,
  })
  return data
}
