/**
 * The app's own pail, drawn for display at size.
 *
 * Separate from the 16px icon set on purpose: those are 1.5px strokes on a 16-unit grid,
 * which is right in a table row and looks spindly and misproportioned the moment it is
 * scaled to 64px. This is the same shape as the application icon — filled, on the same
 * 1024 grid — so it holds together large and matches what sits in the dock.
 */
export function BucketMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} fill="none" aria-hidden>
      {/* Handle first, so its ends sit behind the rim. */}
      <path
        d="M285 352a227 227 0 0 1 454 0"
        stroke="currentColor"
        strokeWidth="48"
        strokeLinecap="round"
        opacity="0.45"
      />
      {/* The opening, lighter than the body so the pail reads as open rather than solid. */}
      <ellipse cx="512" cy="352" rx="268" ry="66" fill="currentColor" opacity="0.35" />
      <path
        d="M244 352l88 434a180 46 0 0 0 360 0l88-434a268 66 0 0 1-536 0z"
        fill="currentColor"
      />
    </svg>
  )
}
