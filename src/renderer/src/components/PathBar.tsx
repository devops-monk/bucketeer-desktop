import { breadcrumbs } from '../lib/format'
import { useSession } from '../store/session'
import { Button } from './primitives'

/**
 * The path bar reads as the S3 URI it actually is — `s3://bucket/prefix/` in monospace —
 * because that string is what users paste into scripts, tickets, and the CLI.
 */
export function PathBar({ onRefresh }: { onRefresh: () => void }) {
  const location = useSession((state) => state.location)
  const goUp = useSession((state) => state.goUp)
  const navigateTo = useSession((state) => state.navigateTo)
  const openBucket = useSession((state) => state.openBucket)
  const loading = useSession((state) => state.loading)

  if (!location) return null

  const crumbs = breadcrumbs(location.prefix)

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
      <Button onClick={() => void goUp()} aria-label="Go up one level">
        ↑
      </Button>

      <div className="tabular flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap text-[12px]">
        <span className="text-faint">s3://</span>
        <button
          onClick={() => void openBucket(location.bucket)}
          className="text-copper hover:underline"
        >
          {location.bucket}
        </button>
        {crumbs.map((crumb) => (
          <span key={crumb.prefix} className="flex items-center gap-0.5">
            <span className="text-faint">/</span>
            <button
              onClick={() => void navigateTo(crumb.prefix)}
              className="text-text hover:text-copper hover:underline"
            >
              {crumb.name}
            </button>
          </span>
        ))}
        <span className="text-faint">/</span>
      </div>

      <Button onClick={onRefresh} disabled={loading} aria-label="Refresh this listing">
        ↻
      </Button>
    </div>
  )
}
