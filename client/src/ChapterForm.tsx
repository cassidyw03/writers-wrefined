import { useState, type ChangeEvent, type FormEvent } from 'react'
import { ACCEPT, checkChapterFile, FORMATS, type InputFormat } from './chapterFile'
import { FormatIcon } from './FormatIcon'

type SourceFormat = 'paste' | 'docx' | 'md'

type Props = {
  disabled: boolean
  onSubmit: (chapter: { title?: string; text: string; sourceFormat: SourceFormat }) => void
}

// The server stores plain-text files as "md": both are read as-is.
const SOURCE_FORMAT: Record<InputFormat, SourceFormat> = { paste: 'paste', docx: 'docx', md: 'md', txt: 'md' }

// Reads an uploaded chapter into plain text. .docx goes through Mammoth (loaded only when needed; it is large); .md and .txt are read as-is.
async function readChapterFile(file: File, format: Exclude<InputFormat, 'paste'>): Promise<string> {
  if (format === 'docx') {
    const { default: mammoth } = await import('mammoth')
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return value
  }
  return file.text()
}

export function ChapterForm({ disabled, onSubmit }: Props) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [format, setFormat] = useState<InputFormat | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    setFileError(null)

    const checked = checkChapterFile(file.name)
    if ('error' in checked) {
      setFileError(checked.error)
      // Clear the picker so choosing a valid file next, or the same one again, still fires a change.
      input.value = ''
      return
    }

    try {
      setText(await readChapterFile(file, checked.format))
      setFormat(checked.format)
      if (!title) setTitle(file.name.replace(/\.(docx|md|markdown|txt)$/i, ''))
    } catch {
      setFileError('Could not read that file. It may be damaged; try saving it again, or paste the text instead.')
      input.value = ''
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    onSubmit({ title: title.trim() || undefined, text, sourceFormat: SOURCE_FORMAT[format ?? 'paste'] })
  }

  return (
    <form className="chapter-form" onSubmit={handleSubmit}>
      <h2>Add a chapter</h2>

      <div className="formats" role="group" aria-label="Accepted formats">
        {FORMATS.map((f) => (
          <span
            key={f.id}
            className={`format${format === f.id ? ' format-active' : ''}`}
            title={f.detail}
            aria-current={format === f.id ? 'true' : undefined}
          >
            <FormatIcon format={f.id} />
            {f.label}
          </span>
        ))}
      </div>

      <label>
        Title <span className="muted">(optional)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chapter 1" />
      </label>

      <label>
        Upload a file <span className="muted">(.docx, .md, or .txt)</span>
        <input type="file" accept={ACCEPT} onChange={handleFile} aria-describedby={fileError ? 'file-error' : undefined} />
      </label>
      {fileError && (
        <p id="file-error" className="notice notice-error" role="alert">
          {fileError}
        </p>
      )}

      <label>
        Or paste the chapter text
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setFormat(e.target.value ? 'paste' : null)
          }}
          rows={12}
          placeholder="Paste your chapter here..."
        />
      </label>

      <div className="form-footer">
        <span className="muted">{text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString()} words` : ''}</span>
        <button type="submit" disabled={disabled || !text.trim()}>
          Extract facts
        </button>
      </div>
    </form>
  )
}
