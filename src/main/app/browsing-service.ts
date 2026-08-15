import type { Bucket, ListObjectsRequest, ListingPage, ObjectDetail } from '@shared/types'
import type { ConnectionRepository, ObjectStorage } from '../core/ports'

/**
 * Use cases for browsing storage. Resolves the connection once and hands the rest to
 * the storage port, keeping the repository lookup out of every adapter method.
 */
export class BrowsingService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly storage: ObjectStorage
  ) {}

  async listBuckets(connectionId: string): Promise<Bucket[]> {
    return this.storage.listBuckets(await this.repository.get(connectionId))
  }

  async listObjects(request: ListObjectsRequest): Promise<ListingPage> {
    const { connectionId, ...rest } = request
    return this.storage.listObjects(await this.repository.get(connectionId), rest)
  }

  async headObject(connectionId: string, bucket: string, key: string): Promise<ObjectDetail> {
    return this.storage.headObject(await this.repository.get(connectionId), bucket, key)
  }
}
