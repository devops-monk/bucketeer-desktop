import type {
  Bucket,
  BucketEncryption,
  ListObjectsRequest,
  ListingPage,
  ObjectDetail,
  ObjectPreview
} from '@shared/types'
import type { ConnectionRepository, ObjectStorage } from '../core/ports'
import { withFreshCredentials } from './credential-retry'

/**
 * Use cases for browsing storage. Resolves the connection once and hands the rest to
 * the storage port, keeping the repository lookup out of every adapter method.
 */
export class BrowsingService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly storage: ObjectStorage
  ) {}

  /**
   * The buckets a connection can see.
   *
   * This is the first call made when a connection is opened, so it is where a stale
   * sign-in shows up. A credential failure here is retried once against a freshly built
   * client, which is what makes "Try again" work after signing in — rather than
   * repeating an answer the SDK cached before the session existed.
   */
  async listBuckets(connectionId: string): Promise<Bucket[]> {
    const connection = await this.repository.get(connectionId)
    return withFreshCredentials(this.storage, connectionId, () =>
      this.storage.listBuckets(connection)
    )
  }

  async listObjects(request: ListObjectsRequest): Promise<ListingPage> {
    const { connectionId, ...rest } = request
    return this.storage.listObjects(await this.repository.get(connectionId), rest)
  }

  /** What the bucket encrypts new objects with by default, when it will tell us. */
  async bucketEncryption(connectionId: string, bucket: string): Promise<BucketEncryption | null> {
    return this.storage.getDefaultEncryption(await this.repository.get(connectionId), bucket)
  }

  /** The first slice of an object, for the preview pane. */
  async preview(
    connectionId: string,
    bucket: string,
    key: string,
    maxBytes: number
  ): Promise<ObjectPreview> {
    return this.storage.getObjectRange(
      await this.repository.get(connectionId),
      bucket,
      key,
      maxBytes
    )
  }

  async headObject(connectionId: string, bucket: string, key: string): Promise<ObjectDetail> {
    return this.storage.headObject(await this.repository.get(connectionId), bucket, key)
  }
}
