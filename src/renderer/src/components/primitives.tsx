import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/** Shared building blocks, so spacing and states stay consistent across the app. */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
}

export function Button({ variant = 'ghost', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[3px] px-2.5 text-[12px] whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none'
  const variants = {
    primary: 'bg-accent text-on-accent font-medium hover:brightness-110',
    ghost: 'text-muted hover:bg-raised hover:text-text',
    danger: 'text-danger hover:bg-danger/10'
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-faint">{hint}</span> : null}
    </label>
  )
}

const controlStyles =
  'h-8 w-full rounded-[3px] border border-line bg-ink px-2.5 text-[12px] text-text placeholder:text-faint focus:border-accent focus:outline-none'

// Forwards its ref so dialogs can focus and select the field on open.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return (
      <input ref={ref} className={`${controlStyles} ${className}`} spellCheck={false} {...props} />
    )
  }
)

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${controlStyles} ${className}`} {...props} />
}

/** A small monospace tag for machine facts: regions, storage classes, credential kinds. */
export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' }) {
  const tones = {
    neutral: 'border-line text-muted',
    accent: 'border-accent-soft text-accent-ink'
  }
  return (
    <span
      className={`tabular rounded-[2px] border px-1.5 py-px text-[10px] uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * Empty states are an invitation to act, so each one names the next step rather than
 * just reporting that there is nothing here.
 */
export function EmptyState({
  title,
  detail,
  action
}: {
  title: string
  detail: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-[13px] text-text">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-muted">{detail}</p>
      {action}
    </div>
  )
}

/** Failures explain what happened and offer the way out, in the app's own voice. */
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-4 flex items-start gap-3 rounded-[3px] border border-danger/40 bg-danger/5 px-3 py-2.5">
      <span className="mt-px text-danger">⚠</span>
      <p className="flex-1 text-[12px] leading-relaxed text-text">{message}</p>
      {onRetry ? (
        <Button onClick={onRetry} variant="ghost">
          Try again
        </Button>
      ) : null}
    </div>
  )
}

/** Indeterminate progress as a hairline, so it never shifts the layout. */
export function LoadingBar() {
  return (
    <div className="h-px w-full overflow-hidden bg-line-soft">
      <div className="h-full w-1/3 animate-[slide_1.1s_ease-in-out_infinite] bg-accent" />
      <style>{`@keyframes slide { 0% { transform: translateX(-100%) } 100% { transform: translateX(400%) } }`}</style>
    </div>
  )
}
