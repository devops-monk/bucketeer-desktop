import { app, BrowserWindow } from 'electron'
import { createContainer } from './container'
import { createMainWindow } from './window'

const container = createContainer()

/** Brings the window back, or makes a new one if it was closed. */
function showWindow(): void {
  const existing = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }
  createMainWindow()
}

async function start(): Promise<void> {
  await app.whenReady()
  // Applied before any window exists, so the first paint is already the right theme.
  await container.settings.applyStoredTheme()
  container.registerIpc()
  createMainWindow()

  // The menu bar or tray item, from which transfers stay visible and reachable with the
  // window closed.
  container.system.attachTray(showWindow)

  // macOS keeps the app alive with no windows; clicking the dock icon reopens one.
  app.on('activate', showWindow)
}

// Without this the app could start, fail to build a window, and sit there with no
// window and no explanation.
start().catch((error: unknown) => {
  console.error('Bucketeer failed to start:', error)
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => container.dispose())

// Refuse to render remote content: this app only ever loads its own bundle.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && url !== process.env.ELECTRON_RENDERER_URL) {
      event.preventDefault()
    }
  })
})
