import { app, shell } from 'electron'
import { Channels } from '@shared/ipc'
import type { Preferences, ThemePreference } from '@shared/types'
import type { SettingsStore } from '../infra/settings-store'
import type { IpcModule, IpcRouter } from './router'

/** Channels for the application itself, as opposed to anything stored in S3. */
export class AppModule implements IpcModule {
  constructor(
    private readonly settings: SettingsStore,
    /** Re-applies preferences to the transfer queue, storage and proxy after a change. */
    private readonly onPreferencesChanged: () => Promise<void>
  ) {}

  register(router: IpcRouter): void {
    router.handle(Channels.appVersion, () => app.getVersion())
    router.handle(Channels.appGetTheme, async () => (await this.settings.read()).theme)
    router.handle(Channels.appSetTheme, (theme: ThemePreference) => this.settings.setTheme(theme))
    router.handle(Channels.appGetPreferences, async () => (await this.settings.read()).preferences)
    router.handle(Channels.appSetPreferences, async (preferences: Preferences) => {
      await this.settings.setPreferences(preferences)
      await this.onPreferencesChanged()
    })
    router.handle(Channels.appDownloadsFolder, () => app.getPath('downloads'))
    // Dragging an object out of the window is not possible — Electron's startDrag needs
    // a file that already exists, and it exposes no promised-file API — so the next best
    // thing is putting the downloaded file in front of the user.
    router.handle(Channels.appRevealFile, (path: string) => {
      shell.showItemInFolder(path)
    })
  }
}
