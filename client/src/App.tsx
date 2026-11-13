import { useEffect, useState } from 'react'
import {
  addChapter,
  getBook,
  getBooks,
  getChapter,
  getHealth,
  type Book,
  type BookSummary,
  type ChapterResult,
  type FactType,
  type NewChapter,
} from './api'
import { authClient } from './authClient'
import { BookPicker } from './BookPicker'
import { ChapterForm } from './ChapterForm'
import { FactList } from './FactList'
import { FlagList } from './FlagList'
import { LoginForm } from './LoginForm'
import { WorldStateView } from './WorldStateView'
import './App.css'

type ApiStatus = 'checking' | 'online' | 'offline'

function App() {
  const [status, setStatus] = useState<ApiStatus>('checking')
  const { data: session, isPending } = authClient.useSession()

  useEffect(() => {
    getHealth()
      .then((body) => setStatus(body.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'))
  }, [])

  return (
    <div className="layout">
      <header className="site-header">
        <h1>Writers Wrefined</h1>
        <p className="tagline">A continuity checker for authors. Technology prototype.</p>
        <p className={`status status-${status}`}>API: {status}</p>
        {session && (
          <p className="account">
            <span>Logged in as {session.user.name || session.user.email}</span>
            <button type="button" className="link-button" onClick={() => authClient.signOut()}>
              Log out
            </button>
          </p>
        )}
      </header>

      {isPending ? null : session ? (
        // Keyed by user so logging in as someone else starts with a fresh book.
        <Workspace key={session.user.id} userId={session.user.id} apiOnline={status === 'online'} />
      ) : (
        <main className="content content-wide">
          <LoginForm />
        </main>
      )}
    </div>
  )
}

// Remembers the last book each author opened, so a reload comes back to it. Storage can be blocked; that is fine.
const lastBookKey = (userId: string) => `writers-wrefined:last-book:${userId}`

function readLastBook(userId: string) {
  try {
    return localStorage.getItem(lastBookKey(userId))
  } catch {
    return null
  }
}

function saveLastBook(userId: string, bookId: string) {
  try {
    localStorage.setItem(lastBookKey(userId), bookId)
  } catch {
    // Not remembering the book is only a small inconvenience.
  }
}

// The signed-in view: the author's books and chapters on the side, the chapter form and results in the middle.
function Workspace({ userId, apiOnline }: { userId: string; apiOnline: boolean }) {
  const [books, setBooks] = useState<BookSummary[]>([])
  const [book, setBook] = useState<Book | null>(null)
  const [result, setResult] = useState<ChapterResult | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The middle of the page shows either a chapter's results or the world-state view (FR12).
  const [view, setView] = useState<'chapter' | 'world'>('chapter')

  const refreshBooks = () =>
    getBooks()
      .then((list) => {
        setBooks(list)
        return list
      })
      .catch(() => [] as BookSummary[])

  async function openBook(id: string) {
    setError(null)
    setResult(null)
    setView('chapter')
    try {
      setBook(await getBook(id))
      saveLastBook(userId, id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    refreshBooks().then((list) => {
      const last = readLastBook(userId)
      const start = list.find((b) => b.id === last) ?? list[0]
      if (start) openBook(start.id)
    })
    // Runs once per author: Workspace is keyed by user, so userId never changes here.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleBookCreated(created: Book) {
    await refreshBooks()
    setResult(null)
    setError(null)
    setView('chapter')
    setBook(created)
    saveLastBook(userId, created.id)
  }

  async function handleSubmit(chapter: NewChapter) {
    if (!book) return
    const bookId = book.id
    setExtracting(true)
    setError(null)
    setResult(null)
    try {
      setResult(await addChapter(bookId, chapter))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExtracting(false)
      getBook(bookId).then(setBook).catch(() => {})
      refreshBooks()
    }
  }

  async function openChapter(id: string) {
    setError(null)
    setView('chapter')
    try {
      setResult(await getChapter(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <aside className="sidebar">
        <BookPicker
          books={books}
          currentId={book?.id ?? null}
          disabled={extracting}
          onOpen={openBook}
          onCreated={handleBookCreated}
        />
        <h2>{book?.title ?? 'Chapters'}</h2>
        {book && book.chapters.length === 0 && <p className="muted">No chapters yet.</p>}
        <ol className="chapter-list">
          {book?.chapters.map((c) => (
            <li key={c.id}>
              <button
                className={view === 'chapter' && result?.chapter.id === c.id ? 'chapter-link active' : 'chapter-link'}
                onClick={() => openChapter(c.id)}
              >
                <span>Ch. {c.number}{c.title ? `: ${c.title}` : ''}</span>
                <span className="muted">{c.factCount} facts</span>
              </button>
            </li>
          ))}
        </ol>
        {book && book.chapters.length > 0 && (
          <button
            type="button"
            className={view === 'world' ? 'chapter-link world-link active' : 'chapter-link world-link'}
            onClick={() => {
              setError(null)
              setView('world')
            }}
          >
            <span>World state</span>
            <span className="muted">as of any chapter</span>
          </button>
        )}
      </aside>

      <main className="content">
        {view === 'world' && book ? (
          <WorldStateView key={book.id} bookId={book.id} chapterCount={Math.max(0, ...book.chapters.map((c) => c.number))} />
        ) : (
          <>
            <ChapterForm onSubmit={handleSubmit} disabled={extracting || !apiOnline || !book} />

            {extracting && (
              <p className="notice" role="status">
                Claude is reading the chapter, pulling out facts, and checking them against earlier chapters. This usually
                takes two to three minutes.
              </p>
            )}
            {error && <p className="notice notice-error" role="alert">{error}</p>}

            {result && (
              <section className="results">
                <h2>
                  Chapter {result.chapter.number}
                  {result.chapter.title ? `: ${result.chapter.title}` : ''}
                </h2>
                <Summary result={result} />
                <FlagList
                  flags={result.flags}
                  check={result.check}
                  onFlagChange={(flag) =>
                    setResult((r) => r && { ...r, flags: r.flags.map((f) => (f.id === flag.id ? flag : f)) })
                  }
                />
                <FactList facts={result.facts} />
              </section>
            )}
          </>
        )}
      </main>
    </>
  )
}

const TYPES: FactType[] = ['attribute', 'relationship', 'event', 'knowledge']

function Summary({ result }: { result: ChapterResult }) {
  const missing = result.facts.filter((f) => !f.quoteFound).length
  return (
    <dl className="summary">
      <div>
        <dt>Facts</dt>
        <dd>{result.facts.length}</dd>
      </div>
      {TYPES.map((t) => (
        <div key={t}>
          <dt>{t}</dt>
          <dd>{result.facts.filter((f) => f.type === t).length}</dd>
        </div>
      ))}
      <div>
        <dt>Quotes not found</dt>
        <dd className={missing ? 'warn' : ''}>{missing}</dd>
      </div>
      {result.stats && (
        <div>
          <dt>Model · time</dt>
          <dd>
            {result.stats.model} · {result.stats.seconds}s
          </dd>
        </div>
      )}
    </dl>
  )
}

export default App
