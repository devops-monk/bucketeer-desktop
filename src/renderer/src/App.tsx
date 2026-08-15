import { useEffect, useState } from 'react'
import type { ConnectionSummary } from '@shared/types'
import { BucketList } from './components/BucketList'
import { ConnectionEditor } from './components/ConnectionEditor'
import { ConnectionRail } from './components/ConnectionRail'
import { ManifestStrip } from './components/ManifestStrip'
import { ObjectTable } from './components/ObjectTable'
import { PathBar } from './components/PathBar'
import { Button, EmptyState, ErrorNotice, LoadingBar } from './components/primitives'
import { useSession } from './store/session'

/**
 * Three zones, fixed for the life of the window: connections on the left, the current
 * listing in the middle, and the manifest strip along the bottom. Nothing here scrolls
 * except the listing itself.
 */
export function App() {
  const [editing, setEditing] = useState<ConnectionSummary | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const connections = useSession((state) => state.connections)
  const activeId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)
  const listing = useSession((state) => state.listing)
  const loading = useSession((state) => state.loading)
  const error = useSession((state) => state.error)
  const loadConnections = useSession((state) => state.loadConnections)
  const refresh = useSession((state) => state.refresh)
  const openConnection = useSession((state) => state.openConnection)

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  function openEditor(connection: ConnectionSummary | null) {
    setEditing(connection)
    setEditorOpen(true)
  }

  return (
    <>
      {/* Drag region: on macOS the toolbar runs under the traffic lights. */}
      <header
        className="flex h-9 shrink-0 items-center border-b border-line bg-panel px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* The wordmark is the one place the brand pink appears unprompted; everywhere
            else it is reserved for things you can act on. */}
        <span className="flex items-center gap-2 pl-[68px]">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
          <span className="text-[12.5px] font-semibold tracking-wide text-accent-ink">
            Bucketeer
          </span>
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <ConnectionRail onAdd={() => openEditor(null)} onEdit={openEditor} />

        <main className="flex min-w-0 flex-1 flex-col bg-ink">
          <PathBar onRefresh={() => void refresh()} />
          {loading ? <LoadingBar /> : null}

          {error ? (
            <ErrorNotice
              message={error}
              onRetry={() => {
                if (location) void refresh()
                else if (activeId) void openConnection(activeId)
              }}
            />
          ) : null}

          {!activeId ? (
            <EmptyState
              title="No connection open"
              detail={
                connections.length === 0
                  ? 'Add a connection with your AWS credentials to start browsing buckets.'
                  : 'Choose a connection on the left to see its buckets.'
              }
              action={
                connections.length === 0 ? (
                  <Button variant="primary" onClick={() => openEditor(null)}>
                    Add a connection
                  </Button>
                ) : undefined
              }
            />
          ) : !location ? (
            <BucketList />
          ) : listing && listing.prefixes.length === 0 && listing.objects.length === 0 && !loading ? (
            <EmptyState
              title="Nothing here"
              detail={`${location.prefix || location.bucket} has no objects at this level. Drop files here to upload them.`}
            />
          ) : (
            <ObjectTable />
          )}
        </main>
      </div>

      <ManifestStrip />

      {editorOpen ? (
        <ConnectionEditor connection={editing} onClose={() => setEditorOpen(false)} />
      ) : null}
    </>
  )
}
