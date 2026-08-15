import { create } from 'zustand'
import type { Transfer } from '@shared/types'
import { api } from '../lib/api'

/**
 * Mirror of the transfer queue, which lives in the main process.
 *
 * The renderer never owns this state — it subscribes and renders. That keeps transfers
 * running correctly even while the user navigates, and means a reopened window shows
 * the true queue rather than an empty one.
 */
interface TransferState {
  transfers: Transfer[]
  /** The panel is opened automatically the first time something is queued. */
  panelOpen: boolean

  subscribe: () => () => void
  setPanelOpen: (open: boolean) => void
  cancel: (id: string) => Promise<void>
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  clearFinished: () => Promise<void>
}

export const useTransfers = create<TransferState>((set, get) => ({
  transfers: [],
  panelOpen: false,

  subscribe() {
    void api.transfers.list().then((transfers) => set({ transfers }))
    return api.transfers.onChanged((transfers) => {
      const wasActive = get().transfers.some(isActive)
      set({ transfers })
      // Show the panel when work starts, but never steal it back after a user closes it
      // mid-flight — only the transition from idle to busy opens it.
      if (!wasActive && transfers.some(isActive)) set({ panelOpen: true })
    })
  },

  setPanelOpen(open) {
    set({ panelOpen: open })
  },

  async cancel(id) {
    await api.transfers.cancel(id)
  },

  async pause(id) {
    await api.transfers.pause(id)
  },

  async resume(id) {
    await api.transfers.resume(id)
  },

  async clearFinished() {
    await api.transfers.clearFinished()
  }
}))

export function isActive(transfer: Transfer): boolean {
  return transfer.status === 'queued' || transfer.status === 'running'
}

/** Paused counts as unfinished: it is waiting on the user, not on the network. */
export function isUnfinished(transfer: Transfer): boolean {
  return isActive(transfer) || transfer.status === 'paused'
}

/** Aggregate progress across everything still moving, for the manifest strip. */
export function summarise(transfers: Transfer[]): {
  active: number
  failed: number
  transferred: number
  total: number
} {
  let active = 0
  let failed = 0
  let transferred = 0
  let total = 0

  for (const transfer of transfers) {
    if (isActive(transfer)) {
      active += 1
      transferred += transfer.transferred
      total += transfer.size
    }
    if (transfer.status === 'failed') failed += 1
  }

  return { active, failed, transferred, total }
}
