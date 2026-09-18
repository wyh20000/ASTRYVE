import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

const base = (props: P, size: number): P => ({
  width: props.size ?? size,
  height: props.size ?? size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  ...props,
  size: undefined
})

export const Icon = {
  Plus: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  X: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  Search: (p: P) => (
    <svg {...base(p, 16)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  Settings: (p: P) => (
    <svg {...base(p, 16)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  ChevronDown: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  ChevronRight: (p: P) => (
    <svg {...base(p, 14)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  Folder: (p: P) => (
    <svg {...base(p, 15)}>
      <path d="M4 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H12l-2-2H4z" />
    </svg>
  ),
  File: (p: P) => (
    <svg {...base(p, 15)}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
    </svg>
  ),
  FileDir: (p: P) => (
    <svg {...base(p, 15)}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H10z" />
    </svg>
  ),
  Send: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  SendRound: (p: P) => (
    <svg {...base(p, 16)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16V8M8.5 11.5 12 8l3.5 3.5" />
    </svg>
  ),
  Paperclip: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  ),
  Image: (p: P) => (
    <svg {...base(p, 16)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  ),
  Play: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="m6 4 14 8-14 8z" />
    </svg>
  ),
  Export: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M12 3v12M7 8l5-5 5 5M5 21h14" />
    </svg>
  ),
  Check: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  More: (p: P) => (
    <svg {...base(p, 16)}>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  Terminal: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M4 17 10 11 4 5M12 19h8" />
    </svg>
  ),
  Brain: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5.83V15a3 3 0 0 0 6 2.07A3 3 0 0 0 17 15v-.17A3 3 0 0 0 16 8V7a3 3 0 0 0-6-3z" />
    </svg>
  ),
  Trash: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  ),
  Edit: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  ),
  Copy: (p: P) => (
    <svg {...base(p, 16)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  ),
  Link: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  Layout: (p: P) => (
    <svg {...base(p, 16)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18" />
    </svg>
  ),
  Shield: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  Container: (p: P) => (
    <svg {...base(p, 16)}>
      <path d="m21 8-9-5-9 5 9 5 9-5z" />
      <path d="m3 8v8l9 5 9-5V8M12 13v8" />
    </svg>
  )
}
