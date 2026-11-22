// The ways a chapter can come in (FR3), and the check that turns away any other file before it is read.

export type InputFormat = 'paste' | 'docx' | 'md' | 'txt'

export const FORMATS: { id: InputFormat; label: string; detail: string }[] = [
  { id: 'paste', label: 'Paste', detail: 'Paste text into the box' },
  { id: 'docx', label: '.docx', detail: 'Word document' },
  { id: 'md', label: '.md', detail: 'Markdown file' },
  { id: 'txt', label: '.txt', detail: 'Plain text file' },
]

export const ACCEPT = '.docx,.md,.markdown,.txt'

// Which format a file is, from its extension, or an error message naming the accepted formats.
export function checkChapterFile(fileName: string): { format: Exclude<InputFormat, 'paste'> } | { error: string } {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === 'docx' || ext === 'md' || ext === 'txt') return { format: ext }
  if (ext === 'markdown') return { format: 'md' }

  if (ext === 'doc') {
    return { error: 'Older Word .doc files are not supported. In Word, choose Save As > .docx, or paste the chapter text.' }
  }
  const which = ext === 'pdf' ? 'PDF files are' : ext ? `.${ext} files are` : 'That kind of file is'
  return { error: `${which} not supported. Upload a .docx, .md, or .txt file, or paste the chapter text.` }
}
