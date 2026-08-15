import { useMemo, useState } from 'react'
import { formatFullTimestamp } from '../lib/format'
import { useSession } from '../store/session'
import { BucketIcon } from './icons'
import { EmptyState, SearchInput, Tooltip } from './primitives'

/**
 * Buckets are the top level of a connection. Shown as a list rather than a grid of
 * cards: names are the only thing that distinguishes them, and long names must not
 * truncate.
 *
 * The filter is not a convenience. Organisations routinely have hundreds of buckets
 * whose names share a long account-id prefix, which makes scanning by eye useless —
 * the distinguishing part of the name sits in the middle.
 */
export function BucketList() {
  const buckets = useSession((state) => state.buckets)
  const openBucket = useSession((state) => state.openBucket)

  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return buckets

    // Every whitespace-separated term must match, so "fs nonprd" finds a bucket
    // containing both fragments however far apart they sit in the name.
    const terms = needle.split(/\s+/)
    return buckets.filter((bucket) => {
      const name = bucket.name.toLowerCase()
      return terms.every((term) => name.includes(term))
    })
  }, [buckets, filter])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <span className="eyebrow shrink-0">
          {filter ? `${visible.length} of ${buckets.length}` : buckets.length}{' '}
          {buckets.length === 1 ? 'bucket' : 'buckets'}
        </span>
        <div className="flex-1" />
        <SearchInput
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setFilter('')
            // Filtering to a single match and pressing Enter is the whole interaction.
            if (event.key === 'Enter' && visible.length === 1) void openBucket(visible[0].name)
          }}
          placeholder="Filter buckets"
          aria-label="Filter buckets by name"
          className="w-72"
          autoFocus
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No buckets match"
          detail={`None of these ${buckets.length} buckets match “${filter}”. Matching is case-insensitive, and every word must appear somewhere in the name.`}
        />
      ) : (
        <ul className="rise flex-1 overflow-y-auto">
          {visible.map((bucket) => (
            <li key={bucket.name}>
              <button
                onClick={() => void openBucket(bucket.name)}
                className="group flex w-full items-center gap-3 border-b border-line-soft px-4 py-2.5 text-left transition-colors duration-100 hover:bg-hover"
              >
                {/* The app's own pail mark, so a bucket in the list reads as the same
                    thing as the icon in the dock. The previous hollow square read as a
                    checkbox that did nothing. */}
                <Tooltip label="Bucket — click to open">
                  <BucketIcon className="text-faint transition-colors group-hover:text-accent-ink" />
                </Tooltip>
                <span className="tabular flex-1 truncate text-[13px] text-text">
                  {highlight(bucket.name, filter)}
                </span>
                <span className="tabular shrink-0 text-[11px] text-faint">
                  {bucket.createdAt ? formatFullTimestamp(bucket.createdAt) : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Marks the matched fragments. When every name carries the same account-id prefix,
 * showing *where* a name matched is what makes the filtered list readable.
 */
function highlight(name: string, filter: string): React.ReactNode {
  const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return name

  const haystack = name.toLowerCase()
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    let from = haystack.indexOf(term)
    while (from !== -1) {
      ranges.push([from, from + term.length])
      from = haystack.indexOf(term, from + term.length)
    }
  }
  if (ranges.length === 0) return name

  // Merge overlaps, or nested spans would double-wrap the same characters.
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }

  const parts: React.ReactNode[] = []
  let cursor = 0
  merged.forEach(([start, end], index) => {
    if (cursor < start) parts.push(name.slice(cursor, start))
    parts.push(
      <mark key={index} className="bg-transparent font-semibold text-accent-ink">
        {name.slice(start, end)}
      </mark>
    )
    cursor = end
  })
  if (cursor < name.length) parts.push(name.slice(cursor))
  return parts
}
