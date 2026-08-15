import { BrowserWindow } from 'electron'
import { Channels } from '@shared/ipc'
import type { SearchUpdate, SsoPending, Transfer } from '@shared/types'
import type { EventBroadcaster } from '../core/ports'

/**
 * Pushes state to every open window.
 *
 * Sends to all windows rather than holding one reference, so state stays correct if a
 * second window is ever opened, and so a closed-and-reopened window cannot be sent to
 * after its web contents are destroyed.
 */
export class WindowBroadcaster implements EventBroadcaster {
  transfersChanged(transfers: Transfer[]): void {
    this.send(Channels.transfersChanged, transfers)
  }

  ssoPending(pending: SsoPending): void {
    this.send(Channels.ssoPending, pending)
  }

  searchUpdated(update: SearchUpdate): void {
    this.send(Channels.searchUpdated, update)
  }

  private send(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }
}
