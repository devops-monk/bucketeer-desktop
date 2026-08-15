import type { Transfer } from '@shared/types'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'
import { isActive, summarise, useTransfers } from '../store/transfers'
import { DownloadIcon, KeyIcon, UploadIcon } from './icons'
import { Button, Tooltip } from './primitives'

/**
 * The transfer queue.
 *
 * Rows keep their place as they finish rather than disappearing, so a batch's outcome
 * can be read after it completes — which is when people actually look. Each row states
 * its own outcome in a mark on the left, so a long list can be scanned down that column
 * alone: green landed, red did not.
 */
export function TransferPanel() {
  const transfers = useTransfers((state) => state.transfers)
  const open = useTransfers((state) => state.panelOpen)
  const setOpen = useTransfers((state) => state.setPanelOpen)
  const cancel = useTransfers((state) => state.cancel)
  const clearFinished = useTransfers((state) => state.clearFinished)

  if (!open || transfers.length === 0) return null

  const { active, failed, transferred, total } = summarise(transfers)
  const done = transfers.filter((transfer) => transfer.status === 'done').length
  const finished = transfers.filter((transfer) => !isActive(transfer)).length
  const percent = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : null

  return (
    <section
      aria-label="Transfers"
      className="flex max-h-72 shrink-0 flex-col border-t border-line bg-surface"
      style={{ boxShadow: '0 -8px 24px rgb(0 0 0 / 0.10)' }}
    >
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line-soft px-3">
        <span className="eyebrow shrink-0">Transfers</span>

        {/* A line of arithmetic, so the header answers "how is it going" without the
            list having to be read. */}
        <span className="tabular flex min-w-0 items-center gap-2 text-[11px]">
          {active > 0 ? (
            <>
              <span className="text-accent-ink">
                {active} in flight{percent === null ? '' : ` · ${percent}%`}
              </span>
              {total > 0 ? (
                <span className="text-faint">
                  {formatBytes(transferred)} of {formatBytes(total)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-faint">
              {done} complete{failed > 0 ? '' : ' · nothing in flight'}
            </span>
          )}
          {failed > 0 ? <span className="text-danger">{failed} failed</span> : null}
        </span>

        <div className="flex-1" />

        <Tooltip label="Remove finished rows from this list">
          <Button onClick={() => void clearFinished()} disabled={finished === 0}>
            Clear finished
          </Button>
        </Tooltip>
        <Tooltip label="Hide this panel. Transfers keep running.">
          <Button onClick={() => setOpen(false)} aria-label="Hide transfers">
            ✕
          </Button>
        </Tooltip>
      </header>

      {/* One bar for the whole batch, above the per-file detail. */}
      {active > 0 ? (
        <div className="h-0.5 w-full shrink-0 bg-line-soft">
          <div
            className="h-full rounded-r-full bg-accent transition-[width] duration-300"
            style={{ width: `${percent ?? 8}%` }}
          />
        </div>
      ) : null}

      <ul className="flex-1 overflow-y-auto">
        {transfers.map((transfer) => (
          <TransferRow
            key={transfer.id}
            transfer={transfer}
            onCancel={() => void cancel(transfer.id)}
          />
        ))}
      </ul>
    </section>
  )
}

function TransferRow({ transfer, onCancel }: { transfer: Transfer; onCancel: () => void }) {
  // An unknown total shows an indeterminate bar rather than a lying 0%.
  const percent =
    transfer.size > 0 ? Math.min(100, (transfer.transferred / transfer.size) * 100) : null
  const running = isActive(transfer)
  const folder = transfer.key.split('/').slice(0, -1).join('/')

  return (
    <li
      className={`flex items-center gap-3 border-b border-line-soft px-3 py-2 ${
        transfer.status === 'failed' ? 'bg-danger-soft/30' : ''
      }`}
    >
      <StatusMark transfer={transfer} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="tabular truncate text-[12px] text-text">{transfer.name}</span>
          {transfer.kmsKeyId ? (
            <Tooltip label={`Encrypted with ${transfer.kmsKeyId}`}>
              <span aria-label="Encrypted">
                <KeyIcon className="h-3 w-3 text-success" />
              </span>
            </Tooltip>
          ) : null}
          <span className="tabular truncate text-[10.5px] text-faint">
            {transfer.bucket}
            {folder ? `/${folder}` : ''}
          </span>
          <div className="flex-1" />
          <span className="tabular shrink-0 text-[11px] whitespace-nowrap text-muted">
            {status(transfer)}
          </span>
        </div>

        {running ? (
          <div className="h-1 w-full overflow-hidden rounded-full bg-line-soft">
            <div
              className={`h-full rounded-full bg-accent transition-[width] duration-200 ${
                percent === null ? 'w-1/4 animate-pulse' : ''
              }`}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
        ) : null}

        {transfer.error ? (
          <span className="text-[11px] leading-snug whitespace-pre-line text-danger">
            {transfer.error}
          </span>
        ) : null}
      </div>

      {running ? (
        <Button onClick={onCancel} size="sm" aria-label={`Cancel ${transfer.name}`}>
          Cancel
        </Button>
      ) : transfer.kind === 'download' && transfer.status === 'done' ? (
        <Tooltip label="Show this file on your machine">
          <Button
            size="sm"
            onClick={() => void api.app.revealFile(transfer.localPath)}
            aria-label={`Show ${transfer.name} in the file manager`}
          >
            Show
          </Button>
        </Tooltip>
      ) : null}
    </li>
  )
}

/**
 * The outcome mark: direction while a transfer runs, result once it stops — so the left
 * column reads as a status list rather than a row of identical arrows.
 */
function StatusMark({ transfer }: { transfer: Transfer }) {
  const shell = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border'
  const label = describeStatus(transfer)

  if (transfer.status === 'done') {
    return (
      <Tooltip label={label}>
        <span className={`${shell} border-success/40 bg-success-soft/60 text-success`}>
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M2.5 6.3 4.8 8.6 9.5 3.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </Tooltip>
    )
  }
  if (transfer.status === 'failed') {
    return (
      <Tooltip label={label}>
        <span className={`${shell} border-danger/40 bg-danger-soft/60 text-danger`}>
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5" strokeLinecap="round" />
          </svg>
        </span>
      </Tooltip>
    )
  }
  if (transfer.status === 'cancelled') {
    return (
      <Tooltip label={label}>
        <span className={`${shell} border-line text-faint`}>
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M3.2 6h5.6" strokeLinecap="round" />
          </svg>
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip label={label}>
      <span
        className={`${shell} ${
          transfer.status === 'running'
            ? 'border-accent/40 bg-accent-soft/40 text-accent-ink'
            : 'border-line text-faint'
        }`}
      >
        {transfer.kind === 'upload' ? (
          <UploadIcon className="h-3 w-3" />
        ) : (
          <DownloadIcon className="h-3 w-3" />
        )}
      </span>
    </Tooltip>
  )
}

function describeStatus(transfer: Transfer): string {
  const direction = transfer.kind === 'upload' ? 'Upload' : 'Download'
  switch (transfer.status) {
    case 'queued':
      return `${direction} waiting its turn`
    case 'running':
      return `${direction} in progress`
    case 'done':
      return `${direction} complete`
    case 'cancelled':
      return `${direction} cancelled`
    case 'failed':
      return `${direction} failed`
  }
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
