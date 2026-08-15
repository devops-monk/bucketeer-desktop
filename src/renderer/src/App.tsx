import { useCallback, useEffect, useState } from 'react'
import type { ConnectionSummary } from '@shared/types'
import { BucketList } from './components/BucketList'
import { ConnectionEditor } from './components/ConnectionEditor'
import { ConnectionRail } from './components/ConnectionRail'
import { ManifestStrip } from './components/ManifestStrip'
import { ObjectDetails } from './components/ObjectDetails'
import { ObjectTable } from './components/ObjectTable'
import { PathBar } from './components/PathBar'
import { Toolbar } from './components/Toolbar'
import { TransferPanel } from './components/TransferPanel'
import { SsoSignIn } from './components/SsoSignIn'
import { Button, EmptyState, ErrorNotice, LoadingBar } from './components/primitives'
import { api, messageFor } from './lib/api'
import { useListingAutoRefresh } from './lib/auto-refresh'
import { resolveUploadEncryption } from './lib/uploads'
import { useSession } from './store/session'
import { useTransfers } from './store/transfers'

/**
 * Three zones, fixed for the life of the window: connections on the left, the current
 * listing in the middle, and the manifest strip along the bottom. Nothing here scrolls
 * except the listing itself.
 */
export function App() {
  const [editing, setEditing] = useState<ConnectionSummary | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [detailsKey, setDetailsKey] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)

  const connections = useSession((state) => state.connections)
  const activeId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)
  const listing = useSession((state) => state.listing)
  const loading = useSession((state) => state.loading)
  const error = useSession((state) => state.error)
  const loadConnections = useSession((state) => state.loadConnections)
  const refresh = useSession((state) => state.refresh)
  const openConnection = useSession((state) => state.openConnection)
  const selectAll = useSession((state) => state.selectAll)
  const clearSelection = useSession((state) => state.clearSelection)

  const uploadOverride = useSession((state) => state.uploadOverride)
  const subscribeTransfers = useTransfers((state) => state.subscribe)

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  // The queue lives in the main process; this only mirrors it.
  useEffect(() => subscribeTransfers(), [subscribeTransfers])

  // S3 has no change notification, so a completed upload has to ask for the reload.
  useListingAutoRefresh()

  // Selection shortcuts. Ignored while typing, or the filter box would hijack them.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return

      if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
        event.preventDefault()
        selectAll()
      }
      if (event.key === 'Escape') clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectAll, clearSelection])

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault()
      setDropActive(false)
      if (!activeId || !location) return

      // File.path was removed from Electron; the preload bridge resolves real paths.
      const paths = [...event.dataTransfer.files].map((file) => window.pathForFile(file)).filter(Boolean)
      if (paths.length === 0) return

      setDropError(null)
      try {
        await api.transfers.upload({
          connectionId: activeId,
          bucket: location.bucket,
          prefix: location.prefix,
          paths,
          encryption: await resolveUploadEncryption(uploadOverride)
        })
      } catch (failure) {
        setDropError(messageFor(failure))
      }
    },
    [activeId, location, uploadOverride]
  )

  function openEditor(connection: ConnectionSummary | null) {
    setEditing(connection)
    setEditorOpen(true)
  }

  // Sign-in is offered only when the failure is an expired session on a profile-based
  // connection — the one case where a login actually fixes it.
  const activeConnection = connections.find((candidate) => candidate.id === activeId)
  const expiredProfile =
    error && /sso|expired|sign in/i.test(error) ? activeConnection?.credentials.profileName : undefined

  const canDrop = Boolean(location)

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

        <main
          className="relative flex min-w-0 flex-1 flex-col bg-ink"
          onDragOver={(event) => {
            if (!canDrop) return
            event.preventDefault()
            setDropActive(true)
          }}
          onDragLeave={(event) => {
            // Only clear when the pointer leaves the pane, not when it crosses a child.
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false)
          }}
          onDrop={(event) => void onDrop(event)}
        >
          <PathBar onRefresh={() => void refresh()} />
          <Toolbar />
          {loading ? <LoadingBar /> : null}

          {error ? (
            <ErrorNotice
              message={error}
              onRetry={() => {
                if (location) void refresh()
                else if (activeId) void openConnection(activeId)
              }}
              /* An expired SSO session is fixable right here rather than in a terminal. */
              action={
                expiredProfile ? (
                  <SsoSignIn
                    profileName={expiredProfile}
                    variant="primary"
                    onSignedIn={() => {
                      if (activeId) void openConnection(activeId)
                    }}
                  />
                ) : undefined
              }
            />
          ) : null}

          {dropError ? <ErrorNotice message={dropError} /> : null}

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
          ) : listing &&
            listing.prefixes.length === 0 &&
            listing.objects.length === 0 &&
            !loading ? (
            <EmptyState
              title="Nothing here"
              detail={`${location.prefix || location.bucket} has no objects at this level. Drop files here to upload them.`}
            />
          ) : (
            <ObjectTable onOpenDetails={setDetailsKey} />
          )}

          {dropActive ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-accent bg-accent/8">
              <p className="rounded-[3px] bg-panel px-3 py-1.5 text-[12px] text-text shadow-lg">
                Upload to {location ? `s3://${location.bucket}/${location.prefix}` : ''}
              </p>
            </div>
          ) : null}
        </main>

        {detailsKey ? (
          <ObjectDetails objectKey={detailsKey} onClose={() => setDetailsKey(null)} />
        ) : null}
      </div>

      <TransferPanel />
      <ManifestStrip />

      {editorOpen ? (
        <ConnectionEditor connection={editing} onClose={() => setEditorOpen(false)} />
      ) : null}
    </>
  )
}
