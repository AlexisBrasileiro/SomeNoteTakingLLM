export type NoteType = 0 | 1 | 2 | 3 // 0=FreeNote, 1=CalendarNote, 2=Document, 3=Chat

export interface AuthUser {
  userId: string
  userName: string
  email: string
  role: string
}

export interface Project {
  id: string
  ownerId: string
  name: string
  description?: string
  isArchived: boolean
  paperlessTagId?: number | null
  createdAt: string
  updatedAt: string
}

export interface Note {
  id: string
  ownerId: string
  projectId?: string
  parentNoteId?: string
  title?: string
  content?: string
  noteDate?: string
  depth: number
  noteType: NoteType
  createdAt: string
  updatedAt: string
}

export interface ChatReference {
  type: 'note' | 'paperless_document' | 'paperless_tag'
  id: string
  title: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  references?: ChatReference[]
  createdAt: string
}

export interface ChatSummary {
  id: string
  title: string
  projectId?: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

