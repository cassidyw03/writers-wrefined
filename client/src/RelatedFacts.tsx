import { useState } from 'react'
import { getRelatedFacts, type RelatedFact } from './api'

// The continuity checker only compares facts at least this similar (MIN_SIMILARITY in server/src/chapters/service.ts).
const CHECKED_SIMILARITY = 0.7
const SHOWN = 3

type State = { status: 'closed' } | { status: 'loading' } | { status: 'open'; facts: RelatedFact[] } | { status: 'error'; message: string }

// The closest facts from earlier chapters, found by meaning with embeddings (FR7). Loaded when the writer asks.
export function RelatedFacts({ factId }: { factId: string }) {
  const [state, setState] = useState<State>({ status: 'closed' })
  const [loaded, setLoaded] = useState<RelatedFact[] | null>(null)

  async function toggle() {
    if (state.status === 'open') return setState({ status: 'closed' })
    if (loaded) return setState({ status: 'open', facts: loaded })
    setState({ status: 'loading' })
    try {
      const facts = (await getRelatedFacts(factId)).slice(0, SHOWN)
      setLoaded(facts)
      setState({ status: 'open', facts })
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Could not load related facts.' })
    }
  }

  return (
    <div className="related">
      <button type="button" className="related-toggle" onClick={toggle} aria-expanded={state.status === 'open'}>
        {state.status === 'open' ? 'Hide related earlier facts' : state.status === 'loading' ? 'Finding related facts…' : 'Show related earlier facts'}
      </button>

      {state.status === 'error' && <p className="warn">{state.message}</p>}
      {state.status === 'open' &&
        (state.facts.length === 0 ? (
          <p className="muted related-empty">No earlier facts to compare with.</p>
        ) : (
          <ol className="related-list">
            {state.facts.map((f) => (
              <li key={f.id} className="related-fact">
                <div className="related-head">
                  <span className="related-chapter">Ch. {f.chapterNumber}</span>
                  <span className="related-score" title="How close in meaning, where 100% is the same fact">
                    {Math.round(f.similarity * 100)}% similar
                  </span>
                  {f.similarity >= CHECKED_SIMILARITY && <span className="related-checked">checked for contradictions</span>}
                </div>
                <p className="fact-line">
                  <strong>{f.subject}</strong> · {f.attribute} · <strong>{f.value}</strong>
                </p>
                <blockquote>“{f.quote}”</blockquote>
              </li>
            ))}
          </ol>
        ))}
    </div>
  )
}
