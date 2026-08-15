import { Channels } from '@shared/ipc'
import type {
  CreateBucketRequest,
  CreateFolderRequest,
  DeleteBucketRequest,
  DeleteRequest,
  PresignRequest,
  ObjectHeaders,
  RenameRequest,
  RestoreRequest,
  SetStorageClassRequest,
  TransferObjectsRequest
} from '@shared/types'
import type { BucketService } from '../app/bucket-service'
import type { ObjectService } from '../app/object-service'
import type { IpcModule, IpcRouter } from './router'

/** Channels that change bucket contents. */
export class ObjectModule implements IpcModule {
  constructor(
    private readonly service: ObjectService,
    private readonly buckets: BucketService
  ) {}

  register(router: IpcRouter): void {
    router.handle(Channels.objectsDelete, (request: DeleteRequest) => this.service.remove(request))
    router.handle(Channels.objectsRename, (request: RenameRequest) => this.service.rename(request))
    router.handle(Channels.objectsCreateFolder, (request: CreateFolderRequest) =>
      this.service.createFolder(request)
    )
    router.handle(Channels.objectsPresign, (request: PresignRequest) => this.service.presign(request))
    router.handle(Channels.objectsGetTags, (connectionId: string, bucket: string, key: string) =>
      this.service.tags(connectionId, bucket, key)
    )
    router.handle(
      Channels.objectsSetTags,
      (connectionId: string, bucket: string, key: string, tags: Record<string, string>) =>
        this.service.setTags(connectionId, bucket, key, tags)
    )
    router.handle(
      Channels.objectsSetHeaders,
      (connectionId: string, bucket: string, key: string, headers: ObjectHeaders) =>
        this.service.setHeaders(connectionId, bucket, key, headers)
    )
    router.handle(Channels.objectsRestore, (request: RestoreRequest) =>
      this.service.restore(request)
    )
    router.handle(Channels.objectsCopy, (request: TransferObjectsRequest) =>
      this.buckets.copy(request)
    )
    router.handle(Channels.objectsStorageClass, (request: SetStorageClassRequest) =>
      this.buckets.setStorageClass(request)
    )
    router.handle(Channels.bucketsCreate, (request: CreateBucketRequest) =>
      this.buckets.create(request)
    )
    router.handle(Channels.bucketsDelete, (request: DeleteBucketRequest) =>
      this.buckets.remove(request)
    )
  }
}
