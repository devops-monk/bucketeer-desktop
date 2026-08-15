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
  }
}
