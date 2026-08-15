import {
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'
import type {
  Bucket,
  Connection,
  ListObjectsRequest,
  ListingPage,
  ObjectDetail
} from '@shared/types'
import type { CredentialResolver, ObjectStorage } from '../../core/ports'
import type { S3ClientFactory } from './client-factory'
import { cleanETag, isFolderMarker, toObject, toPrefix } from './mappers'

const PAGE_SIZE = 1000

/** ObjectStorage backed by the AWS SDK. The only place S3 commands are issued. */
export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly factory: S3ClientFactory,
    private readonly credentials: CredentialResolver
  ) {}

  async listBuckets(connection: Connection): Promise<Bucket[]> {
    const result = await this.factory.forConnection(connection).send(new ListBucketsCommand({}))

    return (result.Buckets ?? [])
      .filter((bucket) => Boolean(bucket.Name))
      .map((bucket) => ({
        name: bucket.Name as string,
        createdAt: bucket.CreationDate?.toISOString()
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async listObjects(
    connection: Connection,
    request: Omit<ListObjectsRequest, 'connectionId'>
  ): Promise<ListingPage> {
    const client = await this.factory.forBucket(connection, request.bucket)
    const recursive = request.recursive ?? false

    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: request.bucket,
        Prefix: request.prefix || undefined,
        // Dropping the delimiter flattens the tree and walks every key underneath.
        Delimiter: recursive ? undefined : '/',
        ContinuationToken: request.token ?? undefined,
        MaxKeys: PAGE_SIZE
      })
    )

    const prefixes = (result.CommonPrefixes ?? [])
      .map((common) => toPrefix(common, request.prefix))
      .filter((prefix): prefix is NonNullable<typeof prefix> => prefix !== null)

    const objects = (result.Contents ?? [])
      .filter((entry) => !isFolderMarker(entry, request.prefix))
      .map((entry) => toObject(entry, request.prefix, recursive))
      .filter((object): object is NonNullable<typeof object> => object !== null)

    return {
      prefixes,
      objects,
      // NextContinuationToken is only meaningful while the listing is truncated.
      nextToken: result.IsTruncated ? (result.NextContinuationToken ?? null) : null
    }
  }

  async headObject(connection: Connection, bucket: string, key: string): Promise<ObjectDetail> {
    const client = await this.factory.forBucket(connection, bucket)
    const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))

    return {
      key,
      size: result.ContentLength ?? 0,
      lastModified: result.LastModified?.toISOString(),
      etag: cleanETag(result.ETag),
      contentType: result.ContentType,
      storageClass: result.StorageClass,
      serverSideEncryption: result.ServerSideEncryption,
      kmsKeyId: result.SSEKMSKeyId,
      metadata: result.Metadata
    }
  }

  /**
   * Proves a connection works before the user relies on it. ListBuckets is the real
   * check; the account id is a courtesy, since many roles can read S3 but not call STS.
   */
  async probe(connection: Connection): Promise<{ accountId?: string; buckets: number }> {
    const buckets = await this.listBuckets(connection)
    return { accountId: await this.accountId(connection), buckets: buckets.length }
  }

  private async accountId(connection: Connection): Promise<string | undefined> {
    // Third-party endpoints have no STS at all, so don't even try.
    if (connection.endpoint) return undefined

    const sts = new STSClient({
      region: connection.region,
      credentials: this.credentials.resolve(connection.credentials)
    })
    try {
      const identity = await sts.send(new GetCallerIdentityCommand({}))
      return identity.Account
    } catch {
      return undefined
    } finally {
      sts.destroy()
    }
  }

  forget(connectionId: string): void {
    this.factory.forget(connectionId)
  }

  dispose(): void {
    this.factory.dispose()
  }
}
