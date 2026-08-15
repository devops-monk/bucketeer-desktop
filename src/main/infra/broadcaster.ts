import { BrowserWindow } from 'electron'
import { Channels } from '@shared/ipc'
import type { Transfer } from '@shared/types'
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
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(Channels.transfersChanged, transfers)
      }
    }
  }
}
