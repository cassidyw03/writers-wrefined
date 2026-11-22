import type { InputFormat } from './chapterFile'

// Small line icons for each accepted chapter format. They use currentColor so they follow the text color.
export function FormatIcon({ format }: { format: InputFormat }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  if (format === 'paste') {
    return (
      <svg {...common}>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V3h6v1" />
        <path d="M9 10h6M9 13.5h6M9 17h4" />
      </svg>
    )
  }

  // A page with a folded corner, marked with what is inside.
  const page = (
    <>
      <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M14 2v5h5" />
    </>
  )

  if (format === 'docx') {
    return (
      <svg {...common}>
        {page}
        <path d="M7.5 12l1.4 5 1.6-4 1.6 4 1.4-5" />
      </svg>
    )
  }

  if (format === 'md') {
    return (
      <svg {...common}>
        {page}
        <path d="M7.5 17v-5l2 2.5 2-2.5v5" />
        <path d="M15 12v5m-1.5-1.5L15 17l1.5-1.5" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      {page}
      <path d="M8 12h8M8 15h8M8 18h5" />
    </svg>
  )
}
