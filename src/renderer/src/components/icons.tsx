/**
 * Inline SVG icons.
 *
 * Hand-drawn rather than pulled from a library: the set is small, an icon dependency
 * would outweigh it, and drawing them here keeps every glyph on the same 16px grid with
 * the same 1.5px stroke. All of them inherit `currentColor`, so colour is decided by
 * the element that contains them and themes for free.
 */

type IconProps = { className?: string }

function Svg({ className = '', children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** Folder, for prefixes. Closed tab-and-body shape reads at 16px where a detailed one does not. */
export function FolderIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M1.75 4.25c0-.55.45-1 1-1h3.1c.32 0 .62.15.81.4l.78 1.05c.19.25.49.4.81.4h4c.55 0 1 .45 1 1v5.65c0 .55-.45 1-1 1h-9.5c-.55 0-1-.45-1-1z" />
    </Svg>
  )
}

/** The pail from the app mark, so a bucket in the list reads as the same thing as the icon. */
export function BucketIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 4.5h11l-1.2 8.1c-.07.5-.5.9-1 .9h-6.6c-.5 0-.93-.4-1-.9z" />
      <ellipse cx="8" cy="4.5" rx="5.5" ry="1.6" />
    </Svg>
  )
}

/** A page with a folded corner. The extension label sits beside it, not inside. */
export function FileIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9.5 1.75H4.25c-.55 0-1 .45-1 1v10.5c0 .55.45 1 1 1h7.5c.55 0 1-.45 1-1V5.25z" />
      <path d="M9.25 1.9v2.85c0 .55.45 1 1 1h2.6" />
    </Svg>
  )
}

export function UploadIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 10.5V2.5" />
      <path d="M5 5.5 8 2.5l3 3" />
      <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </Svg>
  )
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 2.5v8" />
      <path d="M5 7.5 8 10.5l3-3" />
      <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </Svg>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 4.5h11" />
      <path d="M6 4.5v-1a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <path d="M4 4.5l.6 8.1c.04.5.46.9.97.9h4.86c.51 0 .93-.4.97-.9L12 4.5" />
    </Svg>
  )
}

export function LinkIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.9.9" />
      <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.9-.9" />
    </Svg>
  )
}

export function NewFolderIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M14.25 8.4V6.1c0-.55-.45-1-1-1h-4c-.32 0-.62-.15-.81-.4l-.78-1.05a1 1 0 0 0-.81-.4h-3.1c-.55 0-1 .45-1 1v7.5c0 .55.45 1 1 1H8" />
      <path d="M11.75 10.25v4M9.75 12.25h4" />
    </Svg>
  )
}

export function RenameIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M11.4 2.85a1.55 1.55 0 0 1 2.2 2.2L6.4 12.25l-3 .8.8-3z" />
      <path d="M10.25 4 12.5 6.25" />
    </Svg>
  )
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M13.25 8a5.25 5.25 0 1 1-1.6-3.77" />
      <path d="M13.5 2.5v3h-3" />
    </Svg>
  )
}

export function UpIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 13V3.5" />
      <path d="M4.25 7.25 8 3.5l3.75 3.75" />
    </Svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </Svg>
  )
}

export function KeyIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="5" cy="11" r="2.5" />
      <path d="M6.8 9.2 13 3h0M11 5l1.5 1.5M9.4 6.6l1.5 1.5" />
    </Svg>
  )
}

export function CopyIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.2" />
      <path d="M10.25 3.75v-1a1 1 0 0 0-1-1h-6.5a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h1" />
    </Svg>
  )
}

export function MoveIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.75 4.5v7.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1H8.4a1 1 0 0 1-.8-.4l-.6-.8a1 1 0 0 0-.8-.4H3.75a1 1 0 0 0-1 1z" />
      <path d="M6.75 9.25h4M9.25 7.5l1.75 1.75-1.75 1.75" />
    </Svg>
  )
}

export function ArchiveIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.25" y="3.25" width="11.5" height="3" rx="0.8" />
      <path d="M3.25 6.25v6.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-6.5" />
      <path d="M6.5 9h3" />
    </Svg>
  )
}

export function SyncIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.75 8a5.25 5.25 0 0 1 8.9-3.78" />
      <path d="M11.75 1.9v2.6h-2.6" />
      <path d="M13.25 8a5.25 5.25 0 0 1-8.9 3.78" />
      <path d="M4.25 14.1v-2.6h2.6" />
    </Svg>
  )
}

export function InfoIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.5M8 4.9v.05" />
    </Svg>
  )
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M12.9 9.8a1.15 1.15 0 0 0 .23 1.27l.04.04a1.4 1.4 0 1 1-1.98 1.98l-.04-.04a1.15 1.15 0 0 0-1.27-.23 1.15 1.15 0 0 0-.7 1.05v.12a1.4 1.4 0 0 1-2.8 0v-.06a1.15 1.15 0 0 0-.75-1.05 1.15 1.15 0 0 0-1.27.23l-.04.04a1.4 1.4 0 1 1-1.98-1.98l.04-.04a1.15 1.15 0 0 0 .23-1.27 1.15 1.15 0 0 0-1.05-.7h-.12a1.4 1.4 0 0 1 0-2.8h.06a1.15 1.15 0 0 0 1.05-.75 1.15 1.15 0 0 0-.23-1.27l-.04-.04a1.4 1.4 0 1 1 1.98-1.98l.04.04a1.15 1.15 0 0 0 1.27.23h.06a1.15 1.15 0 0 0 .7-1.05v-.12a1.4 1.4 0 0 1 2.8 0v.06a1.15 1.15 0 0 0 .7 1.05 1.15 1.15 0 0 0 1.27-.23l.04-.04a1.4 1.4 0 1 1 1.98 1.98l-.04.04a1.15 1.15 0 0 0-.23 1.27v.06a1.15 1.15 0 0 0 1.05.7h.12a1.4 1.4 0 0 1 0 2.8h-.06a1.15 1.15 0 0 0-1.05.7z" />
    </Svg>
  )
}

export function FindIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="7.25" cy="7.25" r="4.5" />
      <path d="M10.6 10.6 13.5 13.5" />
    </Svg>
  )
}
