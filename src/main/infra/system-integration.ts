import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { percentOf, summarise } from '@shared/transfer-summary'
import type { Transfer } from '@shared/types'
import type { EventBroadcaster } from '../core/ports'

/**
 * The parts of the app that live outside its window: the menu bar or system tray item,
 * and the progress the operating system draws on the Dock or taskbar button.
 *
 * Wraps the broadcaster rather than being called separately, so there is one path for
 * "the transfer queue changed" and the window, the tray and the taskbar cannot drift out
 * of step with each other.
 */
export class SystemIntegration implements EventBroadcaster {
  private tray: Tray | null = null

  constructor(private readonly inner: EventBroadcaster) {}

  /**
   * Creates the tray item. macOS tints a template image to match the menu bar, light or
   * dark; Windows and Linux draw the icon as given, so they get the coloured one.
   *
   * Only the 1x file is named: macOS finds the @2x version sitting beside it, which is
   * what keeps the mark sharp on a retina display.
   */
  attachTray(onShow: () => void): void {
    if (this.tray) return

    const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'trayColour.png'
    const icon = nativeImage.createFromPath(join(import.meta.dirname, '../../build', file))
    if (icon.isEmpty()) return // No icon shipped: better no tray than an invisible one.

    icon.setTemplateImage(process.platform === 'darwin')
    this.tray = new Tray(icon)
    this.tray.setToolTip('Bucketeer')
    this.setMenu(onShow, 'No transfers')

    // Clicking the icon shows the window everywhere. On Windows and Linux a left click
    // would otherwise do nothing at all, which reads as a broken icon.
    this.tray.on('click', onShow)
  }

  transfersChanged(transfers: Transfer[]): void {
    this.inner.transfersChanged(transfers)
    this.reflectProgress(transfers)
  }

  ssoPending(pending: Parameters<EventBroadcaster['ssoPending']>[0]): void {
    this.inner.ssoPending(pending)
  }

  searchUpdated(update: Parameters<EventBroadcaster['searchUpdated']>[0]): void {
    this.inner.searchUpdated(update)
  }

  dispose(): void {
    this.tray?.destroy()
    this.tray = null
  }

  /**
   * Shows how far along the queue is without the window having to be open.
   *
   * The Dock and the taskbar both draw a bar from setProgressBar; -1 removes it. macOS
   * additionally gets a badge with the number still in flight, which is legible at a
   * glance in a way a thin bar is not.
   *
   * The fraction comes from the same batch arithmetic the window uses, so the Dock and
   * the panel never show two different answers to the same question.
   */
  private reflectProgress(transfers: Transfer[]): void {
    const summary = summarise(transfers)
    const percent = percentOf(summary)
    // An unknown total shows an indeterminate bar rather than a misleading zero.
    const fraction = summary.active === 0 ? -1 : percent === null ? 2 : percent / 100

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setProgressBar(fraction)
    }

    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge(
        summary.active > 0 ? String(summary.active) : summary.failed > 0 ? '!' : ''
      )
    }

    this.tray?.setToolTip(describe(summary.active, summary.failed))
  }

  private setMenu(onShow: () => void, status: string): void {
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: status, enabled: false },
        { type: 'separator' },
        { label: 'Show Bucketeer', click: onShow },
        { type: 'separator' },
        { label: 'Quit Bucketeer', role: 'quit' }
      ])
    )
  }
}

function describe(active: number, failed: number): string {
  if (active === 0 && failed === 0) return 'Bucketeer'
  const parts: string[] = []
  if (active > 0) parts.push(`${active} transfer${active === 1 ? '' : 's'} in flight`)
  if (failed > 0) parts.push(`${failed} failed`)
  return `Bucketeer — ${parts.join(', ')}`
}
