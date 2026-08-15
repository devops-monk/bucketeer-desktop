import type {
  Bucket,
  BucketEncryption,
  ListObjectsRequest,
  ListingPage,
  ObjectDetail
} from '@shared/types'
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

  /** What the bucket encrypts new objects with by default, when it will tell us. */
  async bucketEncryption(connectionId: string, bucket: string): Promise<BucketEncryption | null> {
    return this.storage.getDefaultEncryption(await this.repository.get(connectionId), bucket)
  }

  async headObject(connectionId: string, bucket: string, key: string): Promise<ObjectDetail> {
    return this.storage.headObject(await this.repository.get(connectionId), bucket, key)
  }
}
