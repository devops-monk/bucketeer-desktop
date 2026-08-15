import { Channels } from '@shared/ipc'
import type { ListObjectsRequest } from '@shared/types'
import type { BrowsingService } from '../app/browsing-service'
import type { IpcModule, IpcRouter } from './router'

/** Channels for reading buckets and objects. */
export class BrowsingModule implements IpcModule {
  constructor(private readonly service: BrowsingService) {}

  register(router: IpcRouter): void {
    router.handle(Channels.bucketsList, (connectionId: string) =>
      this.service.listBuckets(connectionId)
    )
    router.handle(Channels.objectsList, (request: ListObjectsRequest) =>
      this.service.listObjects(request)
    )
    router.handle(Channels.objectHead, (connectionId: string, bucket: string, key: string) =>
      this.service.headObject(connectionId, bucket, key)
    )
    router.handle(
      Channels.objectPreview,
      (connectionId: string, bucket: string, key: string, maxBytes: number) =>
        this.service.preview(connectionId, bucket, key, maxBytes)
    )
    router.handle(Channels.bucketsEncryption, (connectionId: string, bucket: string) =>
      this.service.bucketEncryption(connectionId, bucket)
    )
  }
}
