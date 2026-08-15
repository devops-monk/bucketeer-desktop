import { create } from 'zustand'
import type { Transfer } from '@shared/types'
import { api } from '../lib/api'
import { isActive } from '@shared/transfer-summary'

export { isActive, isUnfinished, percentOf, summarise } from '@shared/transfer-summary'
export type { TransferSummary } from '@shared/transfer-summary'

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
