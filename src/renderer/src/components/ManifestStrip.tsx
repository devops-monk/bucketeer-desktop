import { formatBytes, sumBytes } from '../lib/format'
import { useSession } from '../store/session'

/**
 * The manifest strip.
 *
 * A cargo manifest for whatever is currently in view: how many prefixes and objects,
 * how many bytes, what is selected, whether the listing is complete, and which key
 * encrypts anything uploaded here. It is the one place in the app that always answers
 * "what am I looking at, and what would happen if I dropped a file right now".
 */
export function ManifestStrip() {
  const connections = useSession((state) => state.connections)
  const activeId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)
  const listing = useSession((state) => state.listing)
  const buckets = useSession((state) => state.buckets)
  const selection = useSession((state) => state.selection)

  const connection = connections.find((candidate) => candidate.id === activeId)
  const selectedObjects = listing?.objects.filter((object) => selection.has(object.key)) ?? []

  return (
    <footer className="flex h-7 shrink-0 items-center gap-0 border-t border-accent-soft bg-panel text-[11px]">
      <Cell>
        {connection ? (
          <span className="text-muted">{connection.name}</span>
        ) : (
          <span className="text-faint">No connection open</span>
        )}
      </Cell>

      {connection ? <Cell mono>{connection.region}</Cell> : null}

      {location ? (
        <Cell mono>{location.bucket}</Cell>
      ) : connection ? (
        <Cell>
          {buckets.length} {buckets.length === 1 ? 'bucket' : 'buckets'}
        </Cell>
      ) : null}

      {listing ? (
        <Cell mono>
          {listing.prefixes.length > 0 ? `${listing.prefixes.length} prefixes · ` : ''}
          {listing.objects.length} objects · {formatBytes(sumBytes(listing.objects.map((o) => o.size)))}
          {/* A truncated listing must say so: the totals above are a page, not the whole bucket. */}
          {listing.nextToken ? ' · partial' : ''}
        </Cell>
      ) : null}

      {selectedObjects.length > 0 ? (
        <Cell mono accent>
          {selectedObjects.length} selected ·{' '}
          {formatBytes(sumBytes(selectedObjects.map((object) => object.size)))}
        </Cell>
      ) : null}

      <div className="flex-1" />

      {connection?.kmsKeyId ? (
        <Cell mono>
          {/* Green means encrypted, everywhere in the app. */}
          <span className="text-success" aria-hidden>
            ⚿
          </span>{' '}
          <span className="text-muted">uploads encrypted with {shortKey(connection.kmsKeyId)}</span>
        </Cell>
      ) : null}
    </footer>
  )
}

function Cell({
  children,
  mono = false,
  accent = false
}: {
  children: React.ReactNode
  mono?: boolean
  accent?: boolean
}) {
  return (
    <div
      className={`flex h-full items-center border-r border-line-soft px-3 ${mono ? 'tabular' : ''} ${
        accent ? 'text-accent-ink' : 'text-muted'
      }`}
    >
      {children}
    </div>
  )
}

/** KMS key ARNs are far too long for a status bar; the key id alone identifies it. */
function shortKey(keyId: string): string {
  if (keyId.startsWith('alias/')) return keyId
  const id = keyId.split('/').pop() ?? keyId
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}
