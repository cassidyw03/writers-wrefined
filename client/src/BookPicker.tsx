import { useState, type FormEvent } from 'react'
import { createBook, type Book, type BookSummary } from './api'
import './BookPicker.css'

type Props = {
  books: BookSummary[]
  currentId: string | null
  disabled: boolean
  onOpen: (id: string) => void
  onCreated: (book: Book) => void
}

// Switches between the author's books and creates new ones (FR2).
export function BookPicker({ books, currentId, disabled, onOpen, onCreated }: Props) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onCreated(await createBook(title))
      setTitle('')
      setAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the book')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="book-picker">
      <label htmlFor="book-select">Book</label>
      <select
        id="book-select"
        value={currentId ?? ''}
        disabled={disabled || books.length === 0}
        onChange={(e) => onOpen(e.target.value)}
      >
        {books.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title} ({b.chapterCount} {b.chapterCount === 1 ? 'chapter' : 'chapters'})
          </option>
        ))}
      </select>

      {adding ? (
        <form className="book-new" onSubmit={handleCreate}>
          <input
            type="text"
            aria-label="New book title"
            placeholder="Book title"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <div className="book-new-actions">
            <button type="submit" disabled={saving || !title.trim()}>
              Create
            </button>
            <button type="button" className="link-button" onClick={() => { setAdding(false); setError(null) }}>
              Cancel
            </button>
          </div>
          {error && <p className="book-error" role="alert">{error}</p>}
        </form>
      ) : (
        <button type="button" className="link-button" disabled={disabled} onClick={() => setAdding(true)}>
          + New book
        </button>
      )}
    </div>
  )
}
