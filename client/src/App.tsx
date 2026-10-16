import { useEffect, useState } from 'react'
import { addChapter, getBook, getChapter, getHealth, type Book, type ChapterResult, type FactType } from './api'
import { ChapterForm } from './ChapterForm'
import { FactList } from './FactList'
import './App.css'

type ApiStatus = 'checking' | 'online' | 'offline'

function App() {
  const [status, setStatus] = useState<ApiStatus>('checking')
  const [book, setBook] = useState<Book | null>(null)
  const [result, setResult] = useState<ChapterResult | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshBook = () => getBook().then(setBook).catch(() => setBook(null))

  useEffect(() => {
    getHealth()
      .then((body) => setStatus(body.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'))
    refreshBook()
  }, [])

  async function handleSubmit(chapter: Parameters<typeof addChapter>[0]) {
    setExtracting(true)
    setError(null)
    setResult(null)
    try {
      setResult(await addChapter(chapter))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExtracting(false)
      refreshBook()
    }
  }

  async function openChapter(id: string) {
    setError(null)
    try {
      setResult(await getChapter(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="layout">
      <header className="site-header">
        <h1>Writers Wrefined</h1>
        <p className="tagline">A continuity checker for authors. Technology prototype.</p>
        <p className={`status status-${status}`}>API: {status}</p>
      </header>

      <aside className="sidebar">
        <h2>{book?.title ?? 'Chapters'}</h2>
        {book && book.chapters.length === 0 && <p className="muted">No chapters yet.</p>}
        <ol className="chapter-list">
          {book?.chapters.map((c) => (
            <li key={c.id}>
              <button
                className={result?.chapter.id === c.id ? 'chapter-link active' : 'chapter-link'}
                onClick={() => openChapter(c.id)}
              >
                <span>Ch. {c.number}{c.title ? `: ${c.title}` : ''}</span>
                <span className="muted">{c.factCount} facts</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="content">
        <ChapterForm onSubmit={handleSubmit} disabled={extracting || status !== 'online'} />

        {extracting && (
          <p className="notice" role="status">
            Claude is reading the chapter and pulling out facts. This usually takes one to two minutes.
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
            <FactList facts={result.facts} />
          </section>
        )}
      </main>
    </div>
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
