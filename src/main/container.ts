import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { BrowsingService } from './app/browsing-service'
import { ConnectionService } from './app/connection-service'
import { ObjectService } from './app/object-service'
import { TransferService } from './app/transfer-service'
import type { Clock, IdGenerator, ObjectStorage } from './core/ports'
import { FileConnectionRepository } from './infra/connection-repository'
import { SharedConfigProfileDirectory } from './infra/credentials/profile-directory'
import { KmsKeyDirectory } from './infra/credentials/key-directory'
import { createCredentialResolver } from './infra/credentials/resolver'
import { DeviceCodeSsoAuthenticator } from './infra/credentials/sso-login'
import { S3ClientFactory } from './infra/s3/client-factory'
import { S3ObjectStorage } from './infra/s3/s3-object-storage'
import { WindowBroadcaster } from './infra/broadcaster'
import { ShellUrlOpener } from './infra/url-opener'
import { SafeStorageVault } from './infra/vault'
import { BrowsingModule } from './ipc/browsing-module'
import { ConnectionModule } from './ipc/connection-module'
import { ObjectModule } from './ipc/object-module'
import { TransferModule } from './ipc/transfer-module'
import { IpcRouter } from './ipc/router'

/**
 * Composition root: the single place concrete adapters are chosen and wired together.
 * Everything else receives its collaborators through its constructor.
 */

export interface Container {
  connections: ConnectionService
  browsing: BrowsingService
  objects: ObjectService
  transfers: TransferService
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
  const broadcaster = new WindowBroadcaster()
  const sso = new DeviceCodeSsoAuthenticator(profiles, new ShellUrlOpener())

  const connections = new ConnectionService(
    repository,
    credentials,
    storage,
    profiles,
    sso,
    new KmsKeyDirectory(credentials),
    broadcaster,
    uuidGenerator,
    systemClock
  )
  const browsing = new BrowsingService(repository, storage)
  const objects = new ObjectService(repository, storage)
  const transfers = new TransferService(
    repository,
    storage,
    broadcaster,
    uuidGenerator,
    systemClock
  )

  return {
    connections,
    browsing,
    objects,
    transfers,
    storage,
    registerIpc() {
      const router = new IpcRouter()
      const modules = [
        new ConnectionModule(connections),
        new BrowsingModule(browsing),
        new ObjectModule(objects),
        new TransferModule(transfers)
      ]
      for (const module of modules) module.register(router)
    },
    dispose() {
      // Abort in-flight transfers before tearing down the clients they are using.
      transfers.dispose()
      storage.dispose()
    }
  }
}
