import { useEffect, useRef, useState } from 'react'
import { Button, Input } from './primitives'

/** Shared modal shell: scrim, Escape to dismiss, click-outside to dismiss. */
function Modal({
  label,
  children,
  onClose
}: {
  label: string
  children: React.ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-32 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        className="w-[420px] rounded-[4px] border border-line bg-panel p-4 shadow-2xl"
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Destructive confirmation. Names exactly what will be destroyed rather than asking
 * "are you sure" — the count is the whole point of the pause.
 */
export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
  busy
}: {
  title: string
  detail: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <Modal label={title} onClose={onCancel}>
      <p className="text-[13px] text-text">{title}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{detail}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

/** Single-value prompt, used for new folders and renames. */
export function PromptDialog({
  title,
  label,
  initialValue = '',
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  error
}: {
  title: string
  label: string
  initialValue?: string
  confirmLabel: string
  onConfirm: (value: string) => void
  onCancel: () => void
  busy?: boolean
  error?: string | null
}) {
  const [value, setValue] = useState(initialValue)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  return (
    <Modal label={title} onClose={onCancel}>
      <p className="text-[13px] text-text">{title}</p>
      <label className="mt-3 flex flex-col gap-1.5">
        <span className="eyebrow">{label}</span>
        <Input
          ref={input}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.trim() && !busy) onConfirm(value)
          }}
          className="tabular"
        />
      </label>
      {error ? <p className="mt-2 text-[11.5px] leading-relaxed text-danger">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onConfirm(value)} disabled={busy || !value.trim()}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

/** Shows a generated link and copies it, since the URL is far too long to read. */
export function LinkDialog({
  url,
  expiresLabel,
  onClose
}: {
  url: string
  expiresLabel: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <Modal label="Share link" onClose={onClose}>
      <p className="text-[13px] text-text">Share link</p>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">
        Anyone with this link can download the object. It stops working {expiresLabel}.
      </p>
      <p className="tabular mt-3 max-h-24 overflow-y-auto rounded-[3px] border border-line bg-ink px-2.5 py-2 text-[11px] break-all text-muted">
        {url}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="primary"
          onClick={() => {
            void navigator.clipboard.writeText(url)
            setCopied(true)
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
    </Modal>
  )
}
