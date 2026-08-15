import type { ConnectionSummary } from '@shared/types'
import { useSession } from '../store/session'
import { PlusIcon } from './icons'
import { Button, Tag } from './primitives'

/**
 * The left rail: every saved connection, and which one is open.
 * Connections are listed by the name the user gave them, with the credential label
 * underneath — never the credential itself.
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

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="eyebrow">Connections</span>
        <Button onClick={onAdd} aria-label="Add a connection">
          <PlusIcon />
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {connections.length === 0 ? (
          <p className="px-1.5 py-3 text-[12px] leading-relaxed text-faint">
            No connections yet. Add one to start browsing your buckets.
          </p>
        ) : (
          <ul className="flex flex-col gap-px">
            {connections.map((connection) => {
              const active = connection.id === activeId
              return (
                <li key={connection.id}>
                  <div
                    className={`group flex items-center gap-2 rounded-[3px] px-2 py-1.5 ${
                      active ? 'bg-raised' : 'hover:bg-raised/60'
                    }`}
                  >
                    {/* A pink bar marks the open connection — the same accent used for every actionable thing. */}
                    <span
                      className={`h-7 w-[2px] rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`}
                      aria-hidden
                    />
                    <button
                      onClick={() => void openConnection(connection.id)}
                      className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                    >
                      <span className="w-full truncate text-[12.5px] text-text">
                        {connection.name}
                      </span>
                      <span className="tabular w-full truncate text-[10.5px] text-faint">
                        {connection.credentials.label}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Tag>{connection.region}</Tag>
                      <button
                        onClick={() => onEdit(connection)}
                        className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
                        aria-label={`Edit ${connection.name}`}
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </aside>
  )
}
