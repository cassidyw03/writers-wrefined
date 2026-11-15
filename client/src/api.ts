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

export type BookSummary = {
  id: string
  title: string
  chapterCount: number
}

export type Book = {
  id: string
  title: string
  chapters: ChapterSummary[]
}

export type FlagFact = {
  id: string
  chapterNumber: number
  subject: string
  attribute: string
  value: string
  quote: string
}

export type FlagStatus = 'open' | 'accepted' | 'dismissed'

export type Flag = {
  id: string
  status: FlagStatus
  explanation: string
  newFact: FlagFact
  earlierFact: FlagFact
}

// One event in a chapter's timeline (FR13), in the order it happens in the text.
export type TimelineEntry = {
  id: string
  subject: string
  value: string
  quote: string
  // False when the quote is not in the text, so its place in the order is a guess.
  quoteFound: boolean
}

export type ChapterResult = {
  chapter: { id: string; number: number; title: string | null }
  facts: Fact[]
  timeline: TimelineEntry[]
  flags: Flag[]
  stats?: { model: string; inputTokens: number; outputTokens: number; seconds: number }
  // Only right after adding a chapter. Null when the check could not run.
  check?: { pairsChecked: number; flagsRaised: number; stateChanges: number } | null
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

export const getBooks = () => request<{ books: BookSummary[] }>('/api/books').then((r) => r.books)

export const getBook = (id: string) => request<Book>(`/api/books/${id}`)

export const createBook = (title: string) =>
  request<Book>('/api/books', { method: 'POST', body: JSON.stringify({ title }) })

export const getChapter = (id: string) => request<ChapterResult>(`/api/chapters/${id}`)

export type NewChapter = { title?: string; text: string; sourceFormat: 'paste' | 'docx' | 'md' }

export const addChapter = (bookId: string, chapter: NewChapter) =>
  request<ChapterResult>('/api/chapters', { method: 'POST', body: JSON.stringify({ ...chapter, bookId }) })

export const updateFlag = (id: string, status: FlagStatus) =>
  request<{ flag: Flag }>(`/api/flags/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })

export type WorldDetail = {
  factId: string
  type: 'attribute' | 'relationship' | 'knowledge'
  attribute: string
  value: string
  quote: string
  chapterNumber: number
  history: { value: string; chapterNumber: number }[]
  change: { reason: string; from: string; fromChapter: number } | null
  flags: { id: string | null; status: FlagStatus; explanation: string; earlierValue: string; earlierChapter: number }[]
}

export type WorldSubject = {
  name: string
  kind: 'character' | 'place' | 'object' | 'group'
  details: WorldDetail[]
}

export type WorldState = {
  chapterNumber: number
  latestChapter: number
  subjects: WorldSubject[]
}

export const getWorldState = (bookId: string, chapter?: number) =>
  request<WorldState>(`/api/books/${bookId}/world-state${chapter ? `?chapter=${chapter}` : ''}`)
