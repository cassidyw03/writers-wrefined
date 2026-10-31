import type { ChapterResult, Flag, FlagFact } from './api'
import './FlagList.css'

// Possible contradictions with earlier chapters, each with the earlier fact on the left and the new one on the right.
export function FlagList({ flags, check }: Pick<ChapterResult, 'flags' | 'check'>) {
  if (check === null) {
    return <p className="notice notice-error">The continuity check could not run for this chapter. Its facts were still saved.</p>
  }
  if (flags.length === 0) {
    // Only claim "no contradictions" when we know a check happened.
    return check ? <p className="muted">No contradictions with earlier chapters ({checkSummary(check)}).</p> : null
  }

  return (
    <section className="flags" aria-label="Possible contradictions">
      <h3>
        {flags.length} possible {flags.length === 1 ? 'contradiction' : 'contradictions'}
      </h3>
      {check && <p className="muted">{checkSummary(check)}</p>}
      <ul>
        {flags.map((flag) => (
          <FlagCard key={flag.id} flag={flag} />
        ))}
      </ul>
    </section>
  )
}

function checkSummary(check: NonNullable<ChapterResult['check']>) {
  const changes = check.stateChanges === 1 ? '1 explained change' : `${check.stateChanges} explained changes`
  return `${check.pairsChecked} similar facts compared, ${changes}`
}

function FlagCard({ flag }: { flag: Flag }) {
  return (
    <li className="flag">
      <p className="flag-reason">{flag.explanation}</p>
      <div className="flag-sides">
        <FlagSide label="Earlier" fact={flag.earlierFact} />
        <FlagSide label="This chapter" fact={flag.newFact} />
      </div>
    </li>
  )
}

function FlagSide({ label, fact }: { label: string; fact: FlagFact }) {
  return (
    <div className="flag-side">
      <p className="muted">
        {label} · Chapter {fact.chapterNumber}
      </p>
      <p className="fact-line">
        <strong>{fact.subject}</strong> · {fact.attribute} · <strong>{fact.value}</strong>
      </p>
      <blockquote>“{fact.quote}”</blockquote>
    </div>
  )
}
