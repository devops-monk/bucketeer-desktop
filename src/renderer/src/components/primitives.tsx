import { forwardRef } from 'react'
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

/**
 * A tooltip on hover and on keyboard focus.
 *
 * CSS-only and deliberately delayed: an instant bubble under a moving pointer is noise,
 * and a tool this dense would flicker constantly. Never used to hide something a person
 * needs — only to explain the AWS vocabulary the field is asking for.
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
  const position =
    side === 'top' ? 'bottom-full mb-1.5 origin-bottom' : 'top-full mt-1.5 origin-top'

  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 scale-95 rounded-md border border-line bg-raised px-2 py-1.5 text-[11px] leading-relaxed text-text opacity-0 shadow-md transition-[opacity,transform] duration-150 group-hover/tip:scale-100 group-hover/tip:opacity-100 group-focus-within/tip:scale-100 group-focus-within/tip:opacity-100 ${position}`}
      >
        {label}
      </span>
    </span>
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
