import type { Transfer } from '@shared/types'
import { formatBytes } from '../lib/format'
import { isActive, useTransfers } from '../store/transfers'
import { Button } from './primitives'

/**
 * The transfer queue.
 *
 * Rows keep their place as they finish rather than disappearing, so a batch's outcome
 * can be read after it completes — which is when people actually look. Finished rows
 * clear on request, not automatically.
 */
export function TransferPanel() {
  const transfers = useTransfers((state) => state.transfers)
  const open = useTransfers((state) => state.panelOpen)
  const setOpen = useTransfers((state) => state.setPanelOpen)
  const cancel = useTransfers((state) => state.cancel)
  const clearFinished = useTransfers((state) => state.clearFinished)

  if (!open || transfers.length === 0) return null

  const finished = transfers.filter((transfer) => !isActive(transfer)).length

  return (
    <section
      aria-label="Transfers"
      className="flex max-h-64 shrink-0 flex-col border-t border-line bg-panel"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <span className="eyebrow">Transfers</span>
        <div className="flex-1" />
        <Button onClick={() => void clearFinished()} disabled={finished === 0}>
          Clear finished
        </Button>
        <Button onClick={() => setOpen(false)} aria-label="Hide transfers">
          ✕
        </Button>
      </header>

      <ul className="flex-1 overflow-y-auto">
        {transfers.map((transfer) => (
          <TransferRow key={transfer.id} transfer={transfer} onCancel={() => void cancel(transfer.id)} />
        ))}
      </ul>
    </section>
  )
}

function TransferRow({ transfer, onCancel }: { transfer: Transfer; onCancel: () => void }) {
  // An unknown total shows an indeterminate bar rather than a lying 0%.
  const percent = transfer.size > 0 ? Math.min(100, (transfer.transferred / transfer.size) * 100) : null

  return (
    <li className="flex items-center gap-3 border-b border-line-soft px-3 py-1.5">
      <span
        className="tabular w-8 shrink-0 text-[10px] tracking-wide text-faint uppercase"
        aria-hidden
      >
        {transfer.kind === 'upload' ? '↑' : '↓'}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="tabular truncate text-[12px] text-text">{transfer.name}</span>
          {transfer.kmsKeyId ? (
            <span className="text-success" title="Encrypted with a KMS key" aria-label="Encrypted">
              ⚿
            </span>
          ) : null}
          <div className="flex-1" />
          <span className="tabular shrink-0 text-[11px] text-muted">{status(transfer)}</span>
        </div>

        {isActive(transfer) ? (
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-line-soft">
            <div
              className={`h-full bg-accent ${percent === null ? 'w-1/4 animate-pulse' : ''}`}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
        ) : null}

        {transfer.error ? (
          <span className="text-[11px] leading-snug text-danger">{transfer.error}</span>
        ) : null}
      </div>

      {isActive(transfer) ? (
        <Button onClick={onCancel} aria-label={`Cancel ${transfer.name}`}>
          Cancel
        </Button>
      ) : null}
    </li>
  )
}

function status(transfer: Transfer): string {
  switch (transfer.status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return transfer.size > 0
        ? `${formatBytes(transfer.transferred)} of ${formatBytes(transfer.size)}`
        : formatBytes(transfer.transferred)
    case 'done':
      return formatBytes(transfer.size)
    case 'cancelled':
      return 'Cancelled'
    case 'failed':
      return 'Failed'
  }
}
