import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/** Shared building blocks, so spacing, states and weight stay consistent across the app. */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

/**
 * Buttons carry weight in proportion to consequence: one filled primary per surface,
 * quiet secondaries beside it, ghosts for anything incidental. The pressed state is a
 * real transform, because a tool should feel mechanical.
 */
export function Button({ variant = 'ghost', size = 'md', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap ' +
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-40'

  const sizes = {
    sm: 'h-6 px-2 text-[11.5px]',
    md: 'h-7 px-2.5 text-[12px]'
  }

  const variants = {
    primary: 'bg-accent text-on-accent shadow-sm hover:brightness-[1.08] active:brightness-95',
    secondary:
      'border border-line bg-raised text-text shadow-sm hover:border-line-strong hover:bg-hover',
    ghost: 'text-muted hover:bg-hover hover:text-text',
    danger: 'text-danger hover:bg-danger/10'
  }

  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />
}

/** Distance between the trigger and the bubble. */
const TOOLTIP_GAP = 8
/** Kept this far from the window edge, so a bubble never sits half off-screen. */
const VIEWPORT_MARGIN = 8
/** A pointer crossing the toolbar should not leave a trail of bubbles behind it. */
const TOOLTIP_DELAY_MS = 220

/**
 * A tooltip on hover and on keyboard focus.
 *
 * Rendered into the document body rather than beside its trigger, and positioned from
 * the trigger's measured rectangle. An absolutely positioned bubble is clipped by any
 * ancestor that scrolls or hides its overflow — which in this app is most of them: every
 * dialog, the object panel, the toolbar — and no z-index rescues it, because clipping is
 * not a stacking question. That is why explanations were invisible exactly where the
 * vocabulary is hardest.
 *
 * It flips to the other side when there is no room, and is nudged back inside the window
 * horizontally rather than being allowed to overhang.
 */
export function Tooltip({
  label,
  children,
  side = 'top'
}: {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
}) {
  const id = useId()
  const trigger = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(false)
  const [placement, setPlacement] = useState({ left: 0, top: 0, above: side === 'top' })

  const place = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect()
    if (!anchor) return

    // Measured where it already is; before the first frame this is the previous size,
    // which is close enough to avoid a visible jump and is corrected immediately after.
    const box = bubble.current?.getBoundingClientRect()
    const height = box?.height ?? 32
    const width = box?.width ?? 200

    const fitsAbove = anchor.top - height - TOOLTIP_GAP > VIEWPORT_MARGIN
    const fitsBelow = anchor.bottom + height + TOOLTIP_GAP < window.innerHeight - VIEWPORT_MARGIN
    const above = side === 'top' ? fitsAbove || !fitsBelow : !(fitsBelow || !fitsAbove)

    const centred = anchor.left + anchor.width / 2 - width / 2
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, centred),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
    )

    setPlacement({
      left,
      top: above ? anchor.top - height - TOOLTIP_GAP : anchor.bottom + TOOLTIP_GAP,
      above
    })
  }, [side])

  // Measure once more after the bubble exists, so its real size decides the position.
  useEffect(() => {
    if (!shown) return
    place()

    // Scrolling or resizing moves the trigger out from under a fixed bubble.
    const dismiss = (): void => setShown(false)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [shown, place])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (delay: number): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      place()
      setShown(true)
    }, delay)
  }

  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current)
    setShown(false)
  }

  // A pending bubble must not appear after the component has gone.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return (
    <>
      <span
        ref={trigger}
        className="inline-flex"
        aria-describedby={shown ? id : undefined}
        onMouseEnter={() => show(TOOLTIP_DELAY_MS)}
        onMouseLeave={hide}
        // Keyboard focus is deliberate, so it answers straight away.
        onFocus={() => show(0)}
        onBlur={hide}
      >
        {children}
      </span>

      {shown
        ? createPortal(
            <span
              id={id}
              ref={bubble}
              role="tooltip"
              style={{ left: placement.left, top: placement.top }}
              className={`pointer-events-none fixed z-[100] w-max max-w-[280px] rounded-md border border-line bg-raised px-2 py-1.5 text-[11px] leading-relaxed text-text shadow-md ${
                placement.above ? 'origin-bottom' : 'origin-top'
              }`}
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </>
  )
}

/** The small circled "i" that carries a field's explanation. */
function InfoMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.5M8 4.9v.05" strokeLinecap="round" />
    </svg>
  )
}

export function Field({
  label,
  hint,
  tooltip,
  children
}: {
  label: string
  hint?: string
  /** Explains the field in its own words. Shown behind an info mark beside the label. */
  tooltip?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5">
        <span className="eyebrow">{label}</span>
        {tooltip ? (
          <Tooltip label={tooltip}>
            <button
              type="button"
              tabIndex={0}
              className="text-faint transition-colors hover:text-muted"
              aria-label={`About ${label}`}
            >
              <InfoMark />
            </button>
          </Tooltip>
        ) : null}
      </span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-faint">{hint}</span> : null}
    </label>
  )
}

const controlStyles =
  'h-8 w-full rounded-md border border-line bg-sunken px-2.5 text-[12px] text-text ' +
  'transition-colors duration-150 placeholder:text-faint ' +
  'hover:border-line-strong focus:border-accent focus:outline-none'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return (
      <input ref={ref} className={`${controlStyles} ${className}`} spellCheck={false} {...props} />
    )
  }
)

/** An input with a leading glyph, for search and filter fields. */
export const SearchInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }
>(function SearchInput({ className = '', icon, ...props }, ref) {
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">
        {icon ?? <MagnifierIcon />}
      </span>
      <input ref={ref} className={`${controlStyles} h-7 pl-8`} spellCheck={false} {...props} />
    </div>
  )
})

function MagnifierIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 13.5 13.5" strokeLinecap="round" />
    </svg>
  )
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${controlStyles} ${className}`} {...props} />
}

/** A small monospace tag for machine facts: regions, storage classes, credential kinds. */
export function Tag({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'success'
}) {
  const tones = {
    neutral: 'border-line bg-sunken text-muted',
    accent: 'border-accent-soft bg-accent-soft/40 text-accent-ink',
    success: 'border-success/30 bg-success-soft/60 text-success'
  }
  return (
    <span
      className={`tabular rounded-sm border px-1.5 py-px text-[9.5px] tracking-wider uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * Empty states are an invitation to act, so each one names the next step rather than
 * just reporting that there is nothing here. The mark is drawn faintly because it sets
 * the mood; the sentence does the work.
 */
export function EmptyState({
  title,
  detail,
  action,
  icon
}: {
  title: string
  detail: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      {icon ? <div className="mb-1 text-line-strong">{icon}</div> : null}
      <p className="text-[14px] font-medium text-text">{title}</p>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-muted">{detail}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/** Failures explain what happened and offer the way out, in the app's own voice. */
export function ErrorNotice({
  message,
  onRetry,
  action
}: {
  message: string
  onRetry?: () => void
  /** A way to fix the cause, shown beside the retry. */
  action?: ReactNode
}) {
  return (
    <div className="mx-3 mt-3 rounded-md border border-danger/35 bg-danger-soft/60 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-px shrink-0 text-danger" aria-hidden>
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.75v4M8 11.1v.05" strokeLinecap="round" />
          </svg>
        </span>
        {/* A hard measure, so a long explanation reads as prose instead of stretching
            across the whole window. */}
        <p className="min-w-0 flex-1 max-w-[78ch] text-[12.5px] leading-[1.55] whitespace-pre-line text-text">
          {message}
        </p>
        {/* A bare retry sits on the message's line; anything larger gets its own row,
            otherwise the two share a width and the message wraps a word at a time. */}
        {onRetry && !action ? <Button onClick={onRetry}>Try again</Button> : null}
      </div>

      {action ? (
        <div className="mt-2.5 flex items-start gap-2 border-t border-danger/20 pt-2.5 pl-[22px]">
          <div className="min-w-0 flex-1">{action}</div>
          {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Indeterminate progress as a hairline, so it never shifts the layout. */
export function LoadingBar() {
  return (
    <div className="h-0.5 w-full overflow-hidden bg-line-soft">
      <div className="h-full w-1/3 animate-[slide_1.1s_ease-in-out_infinite] rounded-full bg-accent" />
      <style>{`@keyframes slide { 0% { transform: translateX(-100%) } 100% { transform: translateX(400%) } }`}</style>
    </div>
  )
}
