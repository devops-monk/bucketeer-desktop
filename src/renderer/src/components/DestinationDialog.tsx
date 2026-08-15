import { useEffect, useMemo, useState } from 'react'
import { api, messageFor } from '../lib/api'
import { useSession } from '../store/session'
import { BucketIcon, FolderIcon } from './icons'
import { Button, SearchInput } from './primitives'

/**
 * Chooses where a copy or move lands: a bucket, then a folder inside it.
 *
 * Browsing rather than typing, because a prefix typed from memory is how objects end up
 * somewhere nobody looks again. The path being written to is spelled out in full before
 * anything is confirmed.
 */
export function DestinationDialog({
  title,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel
}: {
  title: string
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onConfirm: (destination: { bucket: string; prefix: string }) => void
  onCancel: () => void
}) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const buckets = useSession((state) => state.buckets)
  const location = useSession((state) => state.location)

  const [bucket, setBucket] = useState<string | null>(null)
  const [prefix, setPrefix] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Folders inside the chosen bucket, one level at a time.
  useEffect(() => {
    if (!connectionId || !bucket) return
    let cancelled = false

    setLoading(true)
    setListError(null)
    api.objects
      .list({ connectionId, bucket, prefix })
      .then((page) => {
        if (!cancelled) setFolders(page.prefixes.map((entry) => entry.prefix))
      })
      .catch((failure: unknown) => {
        if (!cancelled) setListError(messageFor(failure))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, bucket, prefix])

  const visibleBuckets = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return buckets
    return buckets.filter((entry) => entry.name.toLowerCase().includes(needle))
  }, [buckets, filter])

  const sameAsSource = bucket === location?.bucket && prefix === location?.prefix

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-20 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[70vh] w-[560px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
      >
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
          <span className="eyebrow shrink-0">{title}</span>
          {bucket ? (
            <button
              onClick={() => {
                setBucket(null)
                setPrefix('')
              }}
              className="text-[11.5px] text-accent-ink hover:underline"
            >
              Change bucket
            </button>
          ) : (
            <SearchInput
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter buckets"
              className="flex-1"
              autoFocus
            />
          )}
        </header>

        <div className="flex-1 overflow-y-auto">
          {!bucket ? (
            <ul>
              {visibleBuckets.map((entry) => (
                <li key={entry.name}>
                  <button
                    onClick={() => setBucket(entry.name)}
                    className="flex w-full items-center gap-3 border-b border-line-soft px-4 py-2.5 text-left hover:bg-hover"
                  >
                    <BucketIcon className="text-faint" />
                    <span className="tabular truncate text-[12.5px]">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul>
              {prefix ? (
                <li>
                  <button
                    onClick={() => setPrefix(prefix.replace(/[^/]+\/$/, ''))}
                    className="flex w-full items-center gap-3 border-b border-line-soft px-4 py-2.5 text-left hover:bg-hover"
                  >
                    <span className="w-4 text-center text-faint" aria-hidden>
                      ↑
                    </span>
                    <span className="tabular text-[12.5px] text-muted">Up one level</span>
                  </button>
                </li>
              ) : null}

              {folders.map((entry) => (
                <li key={entry}>
                  <button
                    onClick={() => setPrefix(entry)}
                    className="flex w-full items-center gap-3 border-b border-line-soft px-4 py-2.5 text-left hover:bg-hover"
                  >
                    <FolderIcon className="text-accent-ink" />
                    <span className="tabular truncate text-[12.5px]">
                      {entry.slice(prefix.length).replace(/\/$/, '')}
                    </span>
                  </button>
                </li>
              ))}

              {!loading && folders.length === 0 ? (
                <p className="px-4 py-4 text-[12px] text-faint">
                  No folders here. This location can still be the destination.
                </p>
              ) : null}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-4 py-2.5">
          <p className="tabular text-[11.5px] break-all text-muted">
            {bucket ? `s3://${bucket}/${prefix}` : 'Choose a bucket'}
          </p>
          {sameAsSource ? (
            <p className="mt-1 text-[11px] text-faint">
              This is where the objects already are.
            </p>
          ) : null}
          {listError ? <p className="mt-1 text-[11.5px] text-danger">{listError}</p> : null}
          {error ? <p className="mt-1 text-[11.5px] text-danger">{error}</p> : null}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => bucket && onConfirm({ bucket, prefix })}
            disabled={!bucket || busy || sameAsSource}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </footer>
      </div>
    </div>
  )
}
