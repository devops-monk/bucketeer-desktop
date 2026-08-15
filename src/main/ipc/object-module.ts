import { Channels } from '@shared/ipc'
import type {
  CreateFolderRequest,
  DeleteRequest,
  PresignRequest,
  RenameRequest
} from '@shared/types'
import type { ObjectService } from '../app/object-service'
import type { IpcModule, IpcRouter } from './router'

/** Channels that change bucket contents. */
export class ObjectModule implements IpcModule {
  constructor(private readonly service: ObjectService) {}

  register(router: IpcRouter): void {
    router.handle(Channels.objectsDelete, (request: DeleteRequest) => this.service.remove(request))
    router.handle(Channels.objectsRename, (request: RenameRequest) => this.service.rename(request))
    router.handle(Channels.objectsCreateFolder, (request: CreateFolderRequest) =>
      this.service.createFolder(request)
    )
    router.handle(Channels.objectsPresign, (request: PresignRequest) => this.service.presign(request))
  }
}
