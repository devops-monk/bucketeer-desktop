import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { BrowsingService } from './app/browsing-service'
import { ConnectionService } from './app/connection-service'
import type { Clock, IdGenerator, ObjectStorage } from './core/ports'
import { FileConnectionRepository } from './infra/connection-repository'
import { SharedConfigProfileDirectory } from './infra/credentials/profile-directory'
import { createCredentialResolver } from './infra/credentials/resolver'
import { S3ClientFactory } from './infra/s3/client-factory'
import { S3ObjectStorage } from './infra/s3/s3-object-storage'
import { SafeStorageVault } from './infra/vault'
import { BrowsingModule } from './ipc/browsing-module'
import { ConnectionModule } from './ipc/connection-module'
import { IpcRouter } from './ipc/router'

/**
 * Composition root: the single place concrete adapters are chosen and wired together.
 * Everything else receives its collaborators through its constructor.
 */

export interface Container {
  connections: ConnectionService
  browsing: BrowsingService
  storage: ObjectStorage
  registerIpc(): void
  dispose(): void
}

const systemClock: Clock = { nowIso: () => new Date().toISOString() }
const uuidGenerator: IdGenerator = { next: () => randomUUID() }

export function createContainer(): Container {
  const vault = new SafeStorageVault()
  const repository = new FileConnectionRepository(vault, app.getPath('userData'))
  const credentials = createCredentialResolver()
  const storage = new S3ObjectStorage(new S3ClientFactory(credentials), credentials)
  const profiles = new SharedConfigProfileDirectory()

  const connections = new ConnectionService(
    repository,
    credentials,
    storage,
    profiles,
    uuidGenerator,
    systemClock
  )
  const browsing = new BrowsingService(repository, storage)

  return {
    connections,
    browsing,
    storage,
    registerIpc() {
      const router = new IpcRouter()
      for (const module of [new ConnectionModule(connections), new BrowsingModule(browsing)]) {
        module.register(router)
      }
    },
    dispose() {
      storage.dispose()
    }
  }
}
