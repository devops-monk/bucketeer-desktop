import type { ConnectionSummary } from '@shared/types'
import { useSession } from '../store/session'
import { BucketIcon } from './icons'
import { Button, Tag } from './primitives'

/**
 * The first thing anyone sees.
 *
 * It used to be a sentence of grey text on an empty pane, which said nothing about what
 * the app is for and gave a new user nothing to aim at. This states the purpose, shows
 * the mark, and puts the one useful action under the cursor — with the credential types
 * listed, because "will it work with our SSO?" is the first question anyone asks.
 */
export function WelcomePane({ onAdd }: { onAdd: () => void }) {
  const connections = useSession((state) => state.connections)
  const openConnection = useSession((state) => state.openConnection)

  const recent = connections.slice(0, 4)

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8">
      {/* A wash of brand colour behind the mark, so the pane reads as designed rather
          than as an empty container. */}
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-[60%] rounded-full bg-accent/12 blur-[90px]"
        aria-hidden
      />

      <div className="relative flex w-full max-w-md flex-col items-center text-center">
        <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-raised shadow-md">
          <BucketIcon className="h-8 w-8 text-accent" />
        </span>

        <h1 className="text-[20px] font-semibold tracking-tight text-text">
          {connections.length === 0 ? 'Welcome to Bucketeer' : 'Choose a connection'}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          {connections.length === 0
            ? 'Browse, upload and download objects in Amazon S3 and S3-compatible storage. Your credentials stay in this machine’s keychain and are sent nowhere but AWS.'
            : 'Pick one on the left to see its buckets, or add another.'}
        </p>

        {recent.length > 0 ? (
          <ul className="mt-6 flex w-full flex-col gap-1.5">
            {recent.map((connection) => (
              <li key={connection.id}>
                <ConnectionCard
                  connection={connection}
                  onOpen={() => void openConnection(connection.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
            <Tag>SSO</Tag>
            <Tag>AWS profiles</Tag>
            <Tag>IAM roles</Tag>
            <Tag>Access keys</Tag>
            <Tag>MinIO · R2 · Wasabi</Tag>
          </div>
        )}

        <Button variant="primary" onClick={onAdd} className="mt-6 h-8 px-4">
          Add a connection
        </Button>
      </div>
    </div>
  )
}

function ConnectionCard({
  connection,
  onOpen
}: {
  connection: ConnectionSummary
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-md border border-line bg-raised px-3 py-2.5 text-left shadow-sm transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-accent/50"
    >
      <BucketIcon className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-accent-ink" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-text">{connection.name}</span>
        <span className="tabular block truncate text-[10.5px] text-faint">
          {connection.credentials.label}
        </span>
      </span>
      <Tag>{connection.region}</Tag>
    </button>
  )
}
