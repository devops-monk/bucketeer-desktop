import type { Transfer } from './types'

/**
 * Arithmetic over the transfer queue.
 *
 * Shared rather than living in the renderer, because the window, the Dock and the
 * taskbar all draw the same number and must not disagree about it — and because a pure
 * function is testable without a preload bridge to talk to.
 */

export function isActive(transfer: Transfer): boolean {
  return transfer.status === 'queued' || transfer.status === 'running'
}

/** Paused counts as unfinished: it is waiting on the user, not on the network. */
export function isUnfinished(transfer: Transfer): boolean {
  return isActive(transfer) || transfer.status === 'paused'
}

export interface TransferSummary {
  /** Files still queued or running. */
  active: number
  failed: number
  /** Files in this batch that have finished successfully. */
  completed: number
  /** Files counted in the totals below: everything still going, plus everything done. */
  files: number
  transferred: number
  total: number
}

/**
 * Aggregate progress across the batch, for the strip and the panel header.
 *
 * Counts finished files as well as moving ones. Summing only what is still in flight
 * looked right and read completely wrong: with three files running out of two hundred,
 * each completed file left the numerator and the denominator together, so a folder
 * download sat near 0% for its whole life and jumped to 100% at the end.
 *
 * Failed and cancelled files are left out of both sides instead. They are never going
 * to arrive, and keeping them in would hold the bar below 100% for a batch that is
 * genuinely as finished as it will ever be — the count of failures is reported
 * separately, which is the honest way to show them.
 */
export function summarise(transfers: Transfer[]): TransferSummary {
  const summary: TransferSummary = {
    active: 0,
    failed: 0,
    completed: 0,
    files: 0,
    transferred: 0,
    total: 0
  }

  for (const transfer of transfers) {
    if (transfer.status === 'failed') summary.failed += 1
    if (isActive(transfer)) summary.active += 1
    if (transfer.status === 'done') summary.completed += 1

    if (isUnfinished(transfer) || transfer.status === 'done') {
      summary.files += 1
      summary.transferred += transfer.transferred
      // A size of zero means "not known yet" — the first progress report fills it in.
      summary.total += transfer.size
    }
  }

  return summary
}

/** Whole-batch percentage, or null while nothing has a known size to divide by. */
export function percentOf(summary: TransferSummary): number | null {
  if (summary.total <= 0) return null
  return Math.min(100, Math.round((summary.transferred / summary.total) * 100))
}
