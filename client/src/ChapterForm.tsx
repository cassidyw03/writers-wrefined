import { useState, type FormEvent } from 'react'

type SourceFormat = 'paste' | 'docx' | 'md'

type Props = {
  disabled: boolean
  onSubmit: (chapter: { title?: string; text: string; sourceFormat: SourceFormat }) => void
}

// Reads an uploaded chapter into plain text. .docx goes through Mammoth (loaded only when needed; it is large); .md and .txt are read as-is.
async function readChapterFile(file: File): Promise<{ text: string; sourceFormat: SourceFormat }> {
  if (file.name.toLowerCase().endsWith('.docx')) {
    const { default: mammoth } = await import('mammoth')
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return { text: value, sourceFormat: 'docx' }
  }
  return { text: await file.text(), sourceFormat: 'md' }
}

export function ChapterForm({ disabled, onSubmit }: Props) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>('paste')
  const [fileError, setFileError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setFileError(null)
    try {
      const chapter = await readChapterFile(file)
      setText(chapter.text)
      setSourceFormat(chapter.sourceFormat)
      if (!title) setTitle(file.name.replace(/\.(docx|md|txt)$/i, ''))
    } catch {
      setFileError('Could not read that file. Try a .docx, .md, or .txt file.')
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    onSubmit({ title: title.trim() || undefined, text, sourceFormat })
  }

  return (
    <form className="chapter-form" onSubmit={handleSubmit}>
      <h2>Add a chapter</h2>

      <label>
        Title <span className="muted">(optional)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chapter 1" />
      </label>

      <label>
        Upload a file <span className="muted">(.docx, .md, or .txt)</span>
        <input type="file" accept=".docx,.md,.txt" onChange={(e) => handleFile(e.target.files?.[0])} />
      </label>
      {fileError && <p className="notice notice-error">{fileError}</p>}

      <label>
        Or paste the chapter text
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSourceFormat('paste')
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
