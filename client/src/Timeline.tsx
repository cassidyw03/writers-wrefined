import type { TimelineEntry } from './api'
import './Timeline.css'

// A chapter's events in the order they happen in the text (FR13).
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <p className="muted">No plot events were extracted from this chapter.</p>

  const guessed = entries.filter((e) => !e.quoteFound).length
  return (
    <section aria-label="Chapter timeline">
      <p className="muted">
        {entries.length} {entries.length === 1 ? 'event' : 'events'}, in the order they happen in the chapter.
        {guessed > 0 && ` ${guessed} could not be placed exactly because the quote is not in the text.`}
      </p>
      <ol className="timeline">
        {entries.map((e) => (
          <li key={e.id} className={e.quoteFound ? 'timeline-entry' : 'timeline-entry timeline-guess'}>
            <p className="fact-line">
              <strong>{e.subject}</strong> {e.value}
            </p>
            <blockquote>“{e.quote}”</blockquote>
            {!e.quoteFound && <p className="warn">Quote not found in the chapter; placed after the event before it.</p>}
          </li>
        ))}
      </ol>
    </section>
  )
}
