import { useState } from 'react'
import type { Fact, FactType } from './api'

const FILTERS: (FactType | 'all')[] = ['all', 'attribute', 'relationship', 'event', 'knowledge']

export function FactList({ facts }: { facts: Fact[] }) {
  const [filter, setFilter] = useState<FactType | 'all'>('all')
  const shown = filter === 'all' ? facts : facts.filter((f) => f.type === filter)

  if (facts.length === 0) return <p className="muted">No facts were extracted from this chapter.</p>

  return (
    <>
      <div className="filters" role="group" aria-label="Filter by fact type">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? 'chip active' : 'chip'} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      <ul className="facts">
        {shown.map((fact) => (
          <li key={fact.id} className="fact">
            <div className="fact-head">
              <span className={`badge badge-${fact.type}`}>{fact.type}</span>
              <span className="muted">{fact.subjectKind}</span>
            </div>
            <p className="fact-line">
              <strong>{fact.subject}</strong> · {fact.attribute} · <strong>{fact.value}</strong>
            </p>
            <blockquote>“{fact.quote}”</blockquote>
            {!fact.quoteFound && <p className="warn">This quote was not found word for word in the chapter.</p>}
          </li>
        ))}
      </ul>
    </>
  )
}
