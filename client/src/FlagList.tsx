import { useState } from 'react'
import { updateFlag, type ChapterResult, type Flag, type FlagFact, type FlagStatus } from './api'
import './FlagList.css'

type Props = Pick<ChapterResult, 'flags' | 'check'> & {
  onFlagChange: (flag: Flag) => void
}

// Possible contradictions with earlier chapters, each with the earlier fact on the left and the new one on the right.
// The author accepts each one as a real problem or dismisses it (FR11); the choice is saved on the server.
export function FlagList({ flags, check, onFlagChange }: Props) {
  if (check === null) {
    return <p className="notice notice-error">The continuity check could not run for this chapter. Its facts were still saved.</p>
  }
  if (flags.length === 0) {
    // Only claim "no contradictions" when we know a check happened.
    return check ? <p className="muted">No contradictions with earlier chapters ({checkSummary(check)}).</p> : null
  }

  const open = flags.filter((f) => f.status === 'open').length
  const resolved = flags.length - open

  return (
    <section className="flags" aria-label="Possible contradictions">
      <h3>
        {flags.length} possible {flags.length === 1 ? 'contradiction' : 'contradictions'}
        {resolved > 0 && <span className="muted"> · {open} still to review</span>}
      </h3>
      {check && <p className="muted">{checkSummary(check)}</p>}
      <ul>
        {flags.map((flag) => (
          <FlagCard key={flag.id} flag={flag} onChange={onFlagChange} />
        ))}
      </ul>
    </section>
  )
}

function checkSummary(check: NonNullable<ChapterResult['check']>) {
  const changes = check.stateChanges === 1 ? '1 explained change' : `${check.stateChanges} explained changes`
  return `${check.pairsChecked} similar facts compared, ${changes}`
}

const STATUS_LABEL: Record<Exclude<FlagStatus, 'open'>, string> = {
  accepted: 'Accepted: a real problem to fix',
  dismissed: 'Dismissed: not a problem',
}

function FlagCard({ flag, onChange }: { flag: Flag; onChange: (flag: Flag) => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setStatus(status: FlagStatus) {
    setSaving(true)
    setError(null)
    try {
      onChange((await updateFlag(flag.id, status)).flag)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your choice')
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={`flag flag-${flag.status}`}>
      <p className="flag-reason">{flag.explanation}</p>
      <div className="flag-sides">
        <FlagSide label="Earlier" fact={flag.earlierFact} />
        <FlagSide label="This chapter" fact={flag.newFact} />
      </div>
      <div className="flag-actions">
        {flag.status === 'open' ? (
          <>
            <button type="button" className="flag-accept" disabled={saving} onClick={() => setStatus('accepted')}
              title="This is a real contradiction I need to fix">
              Accept
            </button>
            <button type="button" className="flag-dismiss" disabled={saving} onClick={() => setStatus('dismissed')}
              title="This is not a problem">
              Dismiss
            </button>
          </>
        ) : (
          <>
            <span className="flag-status">{STATUS_LABEL[flag.status]}</span>
            <button type="button" className="flag-undo" disabled={saving} onClick={() => setStatus('open')}>
              Undo
            </button>
          </>
        )}
        {error && <span className="flag-error" role="alert">{error}</span>}
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
