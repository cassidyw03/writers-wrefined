import { useEffect, useState } from 'react'
import { getWorldState, type WorldDetail, type WorldState, type WorldSubject } from './api'
import './WorldStateView.css'

const KIND_LABEL: Record<WorldSubject['kind'], string> = {
  character: 'Characters',
  place: 'Places',
  object: 'Objects',
  group: 'Groups',
}

// What is true about every character, place, and object as of a chosen chapter (FR12).
export function WorldStateView({ bookId, chapterCount }: { bookId: string; chapterCount: number }) {
  const [chapter, setChapter] = useState(chapterCount)
  const [state, setState] = useState<WorldState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let current = true
    getWorldState(bookId, chapter)
      .then((s) => {
        if (!current) return
        setState(s)
        setError(null)
      })
      .catch((e) => current && setError(e instanceof Error ? e.message : String(e)))
    // Ignore a slow answer for a chapter the writer has already moved away from.
    return () => {
      current = false
    }
  }, [bookId, chapter])

  if (chapterCount === 0) return <p className="muted">Add a chapter to see the world state.</p>

  const query = filter.trim().toLowerCase()
  const subjects = (state?.subjects ?? []).filter(
    (s) =>
      !query ||
      s.name.toLowerCase().includes(query) ||
      s.details.some((d) => `${d.attribute} ${d.value}`.toLowerCase().includes(query)),
  )
  const kinds = (Object.keys(KIND_LABEL) as WorldSubject['kind'][]).filter((k) => subjects.some((s) => s.kind === k))

  return (
    <section className="world" aria-label="World state">
      <div className="world-head">
        <h2>World state</h2>
        <label className="world-chapter">
          As of chapter
          <select value={chapter} onChange={(e) => setChapter(Number(e.target.value))}>
            {Array.from({ length: chapterCount }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">
        Everything the story has said so far, after chapter {chapter}. Later chapters are left out.
      </p>
      <input
        type="search"
        className="world-filter"
        placeholder="Filter by name or detail"
        aria-label="Filter by name or detail"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {state && subjects.length === 0 && <p className="muted">{query ? 'Nothing matches that filter.' : 'No facts yet.'}</p>}

      {kinds.map((kind) => (
        <div key={kind} className="world-group">
          <h3>{KIND_LABEL[kind]}</h3>
          <ul className="world-subjects">
            {subjects
              .filter((s) => s.kind === kind)
              .map((s) => (
                <SubjectCard key={s.name} subject={s} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function SubjectCard({ subject }: { subject: WorldSubject }) {
  return (
    <li className="world-subject">
      <h4>{subject.name}</h4>
      <ul className="world-details">
        {subject.details.map((d) => (
          <DetailRow key={d.factId} detail={d} />
        ))}
      </ul>
    </li>
  )
}

function DetailRow({ detail }: { detail: WorldDetail }) {
  const openFlags = detail.flags.filter((f) => f.status !== 'dismissed')
  return (
    <li className="world-detail">
      <p className="fact-line">
        <span className="world-attribute">{detail.attribute}</span> <strong>{detail.value}</strong>{' '}
        <span className="muted">· ch. {detail.chapterNumber}</span>
      </p>
      {detail.change && (
        <p className="world-note world-change">
          Changed in ch. {detail.chapterNumber} (was {detail.change.from}, ch. {detail.change.fromChapter}):{' '}
          {detail.change.reason}
        </p>
      )}
      {openFlags.map((f, i) => (
        <p key={f.id ?? i} className="world-note world-flag">
          {f.status === 'accepted' ? 'Contradiction to fix' : 'Possible contradiction'}: ch. {f.earlierChapter} says{' '}
          {f.earlierValue}. {f.explanation}
        </p>
      ))}
      {!detail.change && detail.history.length > 0 && (
        <p className="world-note muted">
          Earlier: {detail.history.map((h) => `${h.value} (ch. ${h.chapterNumber})`).join(', ')}
        </p>
      )}
      <details>
        <summary>Quote</summary>
        <blockquote>“{detail.quote}”</blockquote>
      </details>
    </li>
  )
}
