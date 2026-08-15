import { useEffect, useRef, useState } from 'react'
import type { SearchUpdate } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { formatBytes, formatTimestamp } from '../lib/format'
import { useSession } from '../store/session'
import { FileIcon } from './icons'
import { Button, EmptyState, SearchInput } from './primitives'

/**
 * Finds objects by name anywhere below the current folder.
 *
 * S3 can only filter by prefix, so this is a walk of every key underneath — thousands of
 * requests on a large bucket. That cost is made visible rather than hidden: the count of
 * keys examined climbs as it goes, results appear while it runs, and it can be stopped
 * at any point.
 */
export function SearchPanel({ onClose }: { onClose: () => void }) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)
  const navigateTo = useSession((state) => state.navigateTo)
  const setDetailsKey = useSession((state) => state.setDetailsKey)

  const [query, setQuery] = useState('')
  const [wholeBucket, setWholeBucket] = useState(false)
  const [update, setUpdate] = useState<SearchUpdate | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchId = useRef<string | null>(null)

  useEffect(
    () =>
      api.search.onUpdate((incoming) => {
        // Updates from an earlier search must not overwrite the current one's results.
        if (incoming.id !== searchId.current) return
        setUpdate(incoming)
        if (incoming.done) setRunning(false)
      }),
    []
  )

  // Leaving with a walk still running would keep it costing requests in the background.
  useEffect(() => {
    return () => {
      if (searchId.current) void api.search.cancel(searchId.current)
    }
  }, [])

  async function start() {
    if (!connectionId || !location || !query.trim()) return

    setError(null)
    setUpdate(null)
    setRunning(true)
    try {
      searchId.current = await api.search.start({
        connectionId,
        bucket: location.bucket,
        prefix: wholeBucket ? '' : location.prefix,
        query: query.trim()
      })
    } catch (failure) {
      setError(messageFor(failure))
      setRunning(false)
    }
  }

  function stop() {
    if (searchId.current) void api.search.cancel(searchId.current)
    setRunning(false)
  }

  function open(key: string) {
    const prefix = key.split('/').slice(0, -1).join('/')
    void navigateTo(prefix ? `${prefix}/` : '')
    setDetailsKey(key)
    onClose()
  }

  const matches = update?.matches ?? []

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void start()
            if (event.key === 'Escape') onClose()
          }}
          placeholder="Find objects by name — * and ? work as wildcards"
          className="flex-1"
          autoFocus
        />

        <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted">
          <input
            type="checkbox"
            checked={wholeBucket}
            onChange={(event) => setWholeBucket(event.target.checked)}
            className="accent-[var(--accent)]"
          />
          Whole bucket
        </label>

        {running ? (
          <Button variant="secondary" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void start()} disabled={!query.trim()}>
            Search
          </Button>
        )}
        <Button onClick={onClose} aria-label="Close search">
          ✕
        </Button>
      </div>

      {update || running ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-line-soft bg-surface px-3 py-1.5">
          <span className="tabular text-[11px] text-muted">
            {matches.length} {matches.length === 1 ? 'match' : 'matches'}
          </span>
          <span className="tabular text-[11px] text-faint">
            {(update?.scanned ?? 0).toLocaleString()} objects examined
          </span>
          {running ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />
          ) : null}
          {update?.truncated ? (
            <span className="text-[11px] text-accent-ink">
              stopped at the first {matches.length} — narrow the search to see more
            </span>
          ) : null}
          {update?.cancelled ? <span className="text-[11px] text-faint">stopped</span> : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {error || update?.error ? (
          <p className="m-3 rounded-md border border-danger/35 bg-danger-soft/50 px-3 py-2 text-[12px] text-text">
            {error ?? update?.error}
          </p>
        ) : null}

        {matches.length === 0 && update?.done && !update.error ? (
          <EmptyState
            title="Nothing found"
            detail={`No object under ${wholeBucket ? location?.bucket : location?.prefix || location?.bucket} has a name matching “${query}”. ${update.scanned.toLocaleString()} objects were examined.`}
          />
        ) : null}

        {matches.length === 0 && !update && !running ? (
          <EmptyState
            title="Search this bucket"
            detail="S3 can only filter by prefix, so finding a name means walking every object underneath. Results appear as they are found, and you can stop at any point."
          />
        ) : null}

        <ul>
          {matches.map((object) => (
            <li key={object.key}>
              <button
                onClick={() => open(object.key)}
                className="flex w-full items-center gap-3 border-b border-line-soft px-4 py-2 text-left hover:bg-hover"
              >
                <FileIcon className="text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="tabular block truncate text-[12.5px] text-text">
                    {object.name || object.key.split('/').pop()}
                  </span>
                  <span className="tabular block truncate text-[10.5px] text-faint">
                    {object.key}
                  </span>
                </span>
                <span className="tabular shrink-0 text-[11px] text-muted">
                  {formatBytes(object.size)}
                </span>
                <span className="tabular w-16 shrink-0 text-right text-[11px] text-faint">
                  {formatTimestamp(object.lastModified)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
