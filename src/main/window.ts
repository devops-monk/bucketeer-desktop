import { join } from 'node:path'
import { BrowserWindow, nativeTheme, shell } from 'electron'

/**
 * Creates the application window with the renderer fully sandboxed: no Node, no direct
 * access to anything but the preload bridge.
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 560,
    show: false,
    // Matches the renderer's --ink in each theme, so the first paint is not a flash of
    // the wrong colour on a machine set to dark mode.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121013' : '#F2F3F5',
    // Keep the traffic lights but let the toolbar run to the top edge on macOS.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Paint only once the renderer has something to show, avoiding a white flash.
  window.once('ready-to-show', () => window.show())



  // A renderer that fails to load must not leave an invisible window behind: show the
  // window anyway so the failure is on screen rather than silent.
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Renderer failed to load (${code} ${description}): ${url}`)
    window.show()
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process gone: ${details.reason}`)
  })

  // Anything aimed at another tab or site belongs in the user's browser, not in here.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    void window.loadURL(devServer)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}
