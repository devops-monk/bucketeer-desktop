import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, nativeTheme } from 'electron'
import type { ThemePreference } from '@shared/types'

const FILE = 'settings.json'

interface Settings {
  theme: ThemePreference
}

const DEFAULTS: Settings = { theme: 'system' }

/**
 * Small, non-secret preferences, kept apart from the connection store.
 *
 * Plain JSON on purpose: nothing here is sensitive, and a readable file is easier to
 * reset by hand than an encrypted one when a preference is what breaks someone's app.
 */
export class SettingsStore {
  private cache: Settings | null = null

  private get path(): string {
    return join(app.getPath('userData'), FILE)
  }

  async read(): Promise<Settings> {
    if (this.cache) return this.cache

    let loaded: Settings
    try {
      loaded = { ...DEFAULTS, ...(JSON.parse(await readFile(this.path, 'utf8')) as Partial<Settings>) }
    } catch {
      // Missing or unreadable settings are not worth failing over.
      loaded = { ...DEFAULTS }
    }
    this.cache = loaded
    return loaded
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    const next = { ...(await this.read()), theme }
    this.cache = next
    applyTheme(theme)
    await writeFile(this.path, JSON.stringify(next, null, 2), 'utf8')
  }

  /** Applied at startup, before the window paints, so there is no flash of the wrong theme. */
  async applyStoredTheme(): Promise<ThemePreference> {
    const { theme } = await this.read()
    applyTheme(theme)
    return theme
  }
}

/**
 * Electron's themeSource is what actually drives prefers-color-scheme in the renderer,
 * so the whole stylesheet follows from this one assignment — no theme class to thread
 * through the UI, and native chrome matches too.
 */
function applyTheme(theme: ThemePreference): void {
  nativeTheme.themeSource = theme
}
