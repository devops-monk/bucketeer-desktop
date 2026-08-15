import { formatFullTimestamp } from '../lib/format'
import { useSession } from '../store/session'

/**
 * Buckets are the top level of a connection. Shown as a list rather than a grid of
 * cards: names are the only thing that distinguishes them, and long names must not
 * truncate.
 */
export function BucketList() {
  const buckets = useSession((state) => state.buckets)
  const openBucket = useSession((state) => state.openBucket)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="border-b border-line-soft px-4 py-2">
        <span className="eyebrow">
          {buckets.length} {buckets.length === 1 ? 'bucket' : 'buckets'}
        </span>
      </div>
      <ul>
        {buckets.map((bucket) => (
          <li key={bucket.name}>
            <button
              onClick={() => void openBucket(bucket.name)}
              className="group flex w-full items-center gap-3 border-b border-line-soft px-4 py-2.5 text-left hover:bg-raised"
            >
              {/* The bucket mark: a hollow square that fills copper on hover. */}
              <span
                className="h-2.5 w-2.5 shrink-0 border border-faint transition-colors group-hover:border-copper group-hover:bg-copper"
                aria-hidden
              />
              <span className="tabular flex-1 truncate text-[13px] text-text">{bucket.name}</span>
              <span className="tabular shrink-0 text-[11px] text-faint">
                {bucket.createdAt ? formatFullTimestamp(bucket.createdAt) : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
