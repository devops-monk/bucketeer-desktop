import { GetBucketLocationCommand, S3Client } from '@aws-sdk/client-s3'
import type { Connection } from '@shared/types'
import type { CredentialResolver } from '../../core/ports'

/**
 * Builds and caches S3 clients.
 *
 * Cached per connection *and region*, because a bucket is only addressable from the
 * region it lives in, and a single connection routinely spans several.
 */
export class S3ClientFactory {
  private readonly clients = new Map<string, S3Client>()
  private readonly bucketRegions = new Map<string, string>()

  constructor(private readonly credentials: CredentialResolver) {}

  forConnection(connection: Connection, region?: string): S3Client {
    const effective = region ?? connection.region
    const key = `${connection.id}:${effective}`

    let client = this.clients.get(key)
    if (!client) {
      client = new S3Client({
        region: effective,
        credentials: this.credentials.resolve(connection.credentials),
        endpoint: connection.endpoint || undefined,
        // Non-AWS endpoints almost always need path-style addressing.
        forcePathStyle: connection.forcePathStyle ?? Boolean(connection.endpoint),
        // Buckets often answer from another region; following the redirect keeps
        // browsing working without making the user pick the right region first.
        followRegionRedirects: true
      })
      this.clients.set(key, client)
    }
    return client
  }

  /** A client aimed at the region the bucket actually lives in. */
  async forBucket(connection: Connection, bucket: string): Promise<S3Client> {
    return this.forConnection(connection, await this.regionOf(connection, bucket))
  }

  /**
   * Resolves a bucket's region, remembering the answer. Skipped for custom endpoints,
   * where regions are largely a fiction and GetBucketLocation may not exist.
   */
  private async regionOf(connection: Connection, bucket: string): Promise<string> {
    if (connection.endpoint) return connection.region

    const key = `${connection.id}:${bucket}`
    const cached = this.bucketRegions.get(key)
    if (cached) return cached

    try {
      const result = await this.forConnection(connection).send(
        new GetBucketLocationCommand({ Bucket: bucket })
      )
      // Legacy encoding: empty means us-east-1, and "EU" means eu-west-1.
      const region = !result.LocationConstraint
        ? 'us-east-1'
        : result.LocationConstraint === 'EU'
          ? 'eu-west-1'
          : String(result.LocationConstraint)
      this.bucketRegions.set(key, region)
      return region
    } catch {
      // Plenty of callers can read a bucket without holding s3:GetBucketLocation.
      return connection.region
    }
  }

  /** Called when a connection is edited or removed, so stale credentials aren't reused. */
  forget(connectionId: string): void {
    for (const [key, client] of this.clients) {
      if (key.startsWith(`${connectionId}:`)) {
        client.destroy()
        this.clients.delete(key)
      }
    }
    for (const key of [...this.bucketRegions.keys()]) {
      if (key.startsWith(`${connectionId}:`)) this.bucketRegions.delete(key)
    }
  }

  dispose(): void {
    for (const client of this.clients.values()) client.destroy()
    this.clients.clear()
    this.bucketRegions.clear()
  }
}
