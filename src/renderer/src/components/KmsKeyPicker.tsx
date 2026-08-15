import { useEffect, useMemo, useState } from 'react'
import type { KmsKey } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { Button, Input } from './primitives'

/**
 * Picks a KMS key from the ones the connection can see.
 *
 * Exists because a key ARN is not something a person should have to find and paste, and
 * because a policy written against an ARN will not match an alias — so the picker always
 * hands back the ARN while showing the alias people actually recognise.
 */
export function KmsKeyPicker({
  connectionId,
  onSelect,
  onClose
}: {
  connectionId: string
  onSelect: (keyArn: string) => void
  onClose: () => void
}) {
  const [keys, setKeys] = useState<KmsKey[] | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.credentials
      .kmsKeys(connectionId)
      .then((found) => {
        if (!cancelled) setKeys(found)
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setError(messageFor(failure))
          setKeys([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [connectionId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!keys) return []
    if (!needle) return keys
    return keys.filter(
      (key) =>
        key.alias.toLowerCase().includes(needle) || key.keyArn.toLowerCase().includes(needle)
    )
  }, [keys, filter])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-scrim pt-24 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Choose a KMS key"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[60vh] w-[560px] flex-col overflow-hidden rounded-[4px] border border-line bg-panel shadow-2xl"
      >
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
          <span className="eyebrow shrink-0">KMS keys</span>
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by alias or ARN"
            className="h-7 flex-1"
            autoFocus
          />
        </header>

        <div className="flex-1 overflow-y-auto">
          {keys === null ? (
            <p className="px-4 py-4 text-[12px] text-faint">Loading keys…</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-4 text-[12px] leading-relaxed text-muted">
              {keys.length === 0
                ? 'No keys could be listed. This usually means kms:ListAliases is not granted to these credentials — paste the key ARN instead, which needs no extra permission.'
                : `Nothing matches “${filter}”.`}
            </p>
          ) : (
            <ul>
              {visible.map((key) => (
                <li key={key.keyArn}>
                  <button
                    onClick={() => onSelect(key.keyArn)}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-line-soft px-4 py-2 text-left hover:bg-raised"
                  >
                    <span className="flex items-center gap-2">
                      <span className="tabular text-[12.5px] text-text">
                        {key.alias.replace(/^alias\//, '')}
                      </span>
                      {key.managedByAws ? (
                        <span className="tabular rounded-[2px] border border-line px-1 text-[9px] tracking-wide text-faint uppercase">
                          aws managed
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular text-[10.5px] break-all text-faint">{key.keyArn}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? <p className="px-4 py-2 text-[11.5px] text-danger">{error}</p> : null}

        <footer className="flex shrink-0 justify-end border-t border-line px-4 py-2.5">
          <Button onClick={onClose}>Cancel</Button>
        </footer>
      </div>
    </div>
  )
}
