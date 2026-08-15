import { useEffect, useMemo, useState } from 'react'
import type { ConnectionSummary } from '@shared/types'
import { api } from '../lib/api'
import { useSession } from '../store/session'
import { PlusIcon, RenameIcon, SettingsIcon } from './icons'
import { Button, SearchInput, Tooltip } from './primitives'
import { PreferencesDialog } from './PreferencesDialog'
import { ThemeSwitch } from './ThemeSwitch'

/** Above this many, finding a connection by eye stops working and a filter earns its place. */
const FILTER_THRESHOLD = 7

/**
 * The left rail: every saved connection, and which one is open.
 *
 * Each entry leads with a monogram so the list can be navigated by shape rather than by
 * reading, and states region and credential on one quiet line — the two facts that
 * distinguish otherwise identically named connections across accounts. The credential
 * itself is never shown, only its label.
 */
export function ConnectionRail({
  onAdd,
  onEdit
}: {
  onAdd: () => void
  onEdit: (connection: ConnectionSummary) => void
}) {
  const connections = useSession((state) => state.connections)
  const activeId = useSession((state) => state.activeConnectionId)
  const openConnection = useSession((state) => state.openConnection)

  const [filter, setFilter] = useState('')
  const [version, setVersion] = useState<string | null>(null)
  const [preferencesOpen, setPreferencesOpen] = useState(false)

  useEffect(() => {
    void api.app.version().then(setVersion).catch(() => setVersion(null))
  }, [])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return connections
    return connections.filter(
      (connection) =>
        connection.name.toLowerCase().includes(needle) ||
        connection.region.toLowerCase().includes(needle) ||
        connection.credentials.label.toLowerCase().includes(needle)
    )
  }, [connections, filter])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <span className="eyebrow">Connections</span>
        {connections.length > 0 ? (
          <span className="tabular text-[10px] text-faint">{connections.length}</span>
        ) : null}
        <div className="flex-1" />
        <Tooltip label="Add a connection" side="bottom">
          <Button onClick={onAdd} size="sm" aria-label="Add a connection">
            <PlusIcon />
          </Button>
        </Tooltip>
      </div>

      {connections.length >= FILTER_THRESHOLD ? (
        <div className="px-2 pb-2">
          <SearchInput
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter connections"
            aria-label="Filter connections"
          />
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {connections.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-[12px] leading-relaxed text-faint">
              No connections yet.
              <br />
              Add one to start browsing buckets.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11.5px] text-faint">
            Nothing matches “{filter}”.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {visible.map((connection) => (
              <li key={connection.id}>
                <ConnectionItem
                  connection={connection}
                  active={connection.id === activeId}
                  onOpen={() => void openConnection(connection.id)}
                  onEdit={() => onEdit(connection)}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-line-soft px-3">
        <span className="eyebrow">Bucketeer</span>
        {version ? <span className="tabular text-[10px] text-faint">v{version}</span> : null}
        <div className="flex-1" />
        <Tooltip label="Transfers, bandwidth and proxy">
          <Button size="sm" onClick={() => setPreferencesOpen(true)} aria-label="Preferences">
            <SettingsIcon className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        <ThemeSwitch />
      </footer>

      {preferencesOpen ? <PreferencesDialog onClose={() => setPreferencesOpen(false)} /> : null}
    </aside>
  )
}

function ConnectionItem({
  connection,
  active,
  onOpen,
  onEdit
}: {
  connection: ConnectionSummary
  active: boolean
  onOpen: () => void
  onEdit: () => void
}) {
  return (
    <div
      className={`group relative flex items-center gap-2.5 rounded-md py-2 pr-1.5 pl-3 transition-colors duration-150 ${
        active ? 'bg-raised shadow-sm ring-1 ring-line' : 'hover:bg-hover'
      }`}
    >
      {/* A pink bar marks the open connection — the same accent used for every
          actionable thing. */}
      <span
        className={`absolute top-2 bottom-2 left-0 w-[2px] rounded-full transition-colors ${
          active ? 'bg-accent' : 'bg-transparent'
        }`}
        aria-hidden
      />

      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span
          className={`tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[12px] font-medium uppercase transition-colors ${
            active
              ? 'border-transparent bg-accent text-on-accent'
              : 'border-line bg-sunken text-muted group-hover:border-line-strong'
          }`}
          aria-hidden
        >
          {connection.name.trim().charAt(0) || '?'}
        </span>

        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[12.5px] text-text ${active ? 'font-medium' : ''}`}>
            {connection.name}
          </span>
          {/* Region and credential on one line: the two facts that tell apart two
              connections with the same name in different accounts. */}
          <span className="tabular block truncate text-[10.5px] text-faint">
            {connection.region} · {connection.credentials.label}
          </span>
        </span>
      </button>

      <Tooltip label="Edit this connection">
        <button
          onClick={onEdit}
          className="rounded p-1 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
          aria-label={`Edit ${connection.name}`}
        >
          <RenameIcon className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  )
}
