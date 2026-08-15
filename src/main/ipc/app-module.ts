import { app } from 'electron'
import { Channels } from '@shared/ipc'
import type { ThemePreference } from '@shared/types'
import type { SettingsStore } from '../infra/settings-store'
import type { IpcModule, IpcRouter } from './router'

/** Channels for the application itself, as opposed to anything stored in S3. */
export class AppModule implements IpcModule {
  constructor(private readonly settings: SettingsStore) {}

  register(router: IpcRouter): void {
    router.handle(Channels.appVersion, () => app.getVersion())
    router.handle(Channels.appGetTheme, async () => (await this.settings.read()).theme)
    router.handle(Channels.appSetTheme, (theme: ThemePreference) => this.settings.setTheme(theme))
  }
}
