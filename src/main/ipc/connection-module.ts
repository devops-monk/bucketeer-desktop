import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import { Channels } from '@shared/ipc'
import type { ConnectionDraft, ConnectionService } from '../app/connection-service'
import type { IpcModule, IpcRouter } from './router'

/** Channels for managing saved connections and reading available AWS profiles. */
export class ConnectionModule implements IpcModule {
  constructor(private readonly service: ConnectionService) {}

  register(router: IpcRouter): void {
    router.handle(Channels.connectionsList, () => this.service.list())
    router.handle(Channels.connectionsSave, (draft: ConnectionDraft) => this.service.save(draft))
    router.handle(Channels.connectionsRemove, (id: string) => this.service.remove(id))
    router.handle(Channels.connectionsTest, (id: string) => this.service.test(id))
    router.handle(Channels.connectionsSecretsAvailable, () => this.service.secretsAvailable())
    router.handle(Channels.sharedProfilesList, () => this.service.sharedProfiles())
    router.handle(Channels.credentialsSsoLogin, (profileName: string) =>
      this.service.ssoLogin(profileName)
    )
    router.handle(Channels.credentialsKmsKeys, (connectionId: string) =>
      this.service.listKmsKeys(connectionId)
    )

    // The file itself is read and written here: the renderer is sandboxed, and the path
    // the user picked in a native dialog is what makes touching the disk legitimate.
    router.handle(Channels.connectionsExport, async () => {
      const result = await dialog.showSaveDialog({
        title: 'Export connections',
        defaultPath: join(app.getPath('downloads'), 'bucketeer-connections.json'),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return null

      const payload = await this.service.exportAll()
      await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      return result.filePath
    })

    router.handle(Channels.connectionsImport, async () => {
      const result = await dialog.showOpenDialog({
        title: 'Import connections',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
        buttonLabel: 'Import'
      })
      const path = result.canceled ? null : (result.filePaths[0] ?? null)
      if (!path) return null

      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(path, 'utf8'))
      } catch {
        throw new Error('That file could not be read as JSON.')
      }
      return this.service.importAll(parsed)
    })
  }
}
