const API_URL = import.meta.env.VITE_API_URL ?? ''

export type FactType = 'attribute' | 'relationship' | 'event' | 'knowledge'

export type Fact = {
  id: string
  type: FactType
  subject: string
  subjectKind: 'character' | 'place' | 'object' | 'group'
  attribute: string
  value: string
  quote: string
  quoteFound: boolean
}

export type ChapterSummary = {
  id: string
  number: number
  title: string | null
  factCount: number
}

export type Book = {
  id: string
  title: string
  chapters: ChapterSummary[]
}

export type ChapterResult = {
  chapter: { id: string; number: number; title: string | null }
  facts: Fact[]
  stats?: { model: string; inputTokens: number; outputTokens: number; seconds: number }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    // Sends the session cookie. Only matters if VITE_API_URL points at another origin.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body as T
}

export const getHealth = () => request<{ ok: boolean }>('/api/health')

export const getBook = () => request<Book>('/api/book')

export const getChapter = (id: string) => request<ChapterResult>(`/api/chapters/${id}`)

export const addChapter = (chapter: { title?: string; text: string; sourceFormat: 'paste' | 'docx' | 'md' }) =>
  request<ChapterResult>('/api/chapters', { method: 'POST', body: JSON.stringify(chapter) })
