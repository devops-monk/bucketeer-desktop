import { app, BrowserWindow } from 'electron'
import { createContainer } from './container'
import { createMainWindow } from './window'

const container = createContainer()

async function start(): Promise<void> {
  await app.whenReady()
  // Applied before any window exists, so the first paint is already the right theme.
  await container.settings.applyStoredTheme()
  container.registerIpc()
  createMainWindow()

  // macOS keeps the app alive with no windows; clicking the dock icon reopens one.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
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
