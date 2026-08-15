import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  RestoreObjectCommand,
  GetBucketEncryptionCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  Bucket,
  Connection,
  ListObjectsRequest,
  ListingPage,
  ObjectDetail,
  ObjectHeaders,
  S3Object
} from '@shared/types'
import type {
  CredentialResolver,
  DownloadOptions,
  ObjectStorage,
  UploadOptions
} from '../../core/ports'
import type { S3ClientFactory } from './client-factory'
import { cleanETag, isFolderMarker, toObject, toPrefix } from './mappers'

const PAGE_SIZE = 1000
/** DeleteObjects accepts 1000 keys per request. */
const DELETE_BATCH = 1000
/** 8 MB parts: large enough to keep request overhead low, small enough to retry cheaply. */
const PART_SIZE = 8 * 1024 * 1024
/**
 * CRC32C on every upload and download.
 *
 * S3 verifies the checksum server-side and rejects a part that does not match, which
 * turns a silently corrupted transfer into a failed one. CRC32C is the cheapest of the
 * algorithms the SDK offers and is what AWS uses by default for multipart.
 */
const CHECKSUM_ALGORITHM = 'CRC32C' as const

/** ObjectStorage backed by the AWS SDK. The only place S3 commands are issued. */
export class S3ObjectStorage implements ObjectStorage {
  /** bucket → its default encryption, including a remembered "none". */
  private readonly defaultEncryption = new Map<
    string,
    { sseAlgorithm: string; kmsKeyId?: string } | null
  >()

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
      metadata: result.Metadata,
      cacheControl: result.CacheControl,
      contentDisposition: result.ContentDisposition,
      contentEncoding: result.ContentEncoding,
      contentLanguage: result.ContentLanguage,
      // "ongoing-request=true" while a restore is running, or an expiry date once done.
      restoreStatus: result.Restore
    }
  }

  /**
   * Reads the bucket's default encryption so uploads can name the same key.
   *
   * Bucket default encryption is applied after the bucket policy is evaluated, so a
   * policy requiring SSE-KMS headers rejects an upload that omits them even when the
   * bucket would have encrypted it anyway. Reading the default lets us send the headers
   * the policy demands without the user having to look the key up.
   *
   * Cached because it is per bucket, not per file, and answered optimistically: many
   * roles can write to a bucket without holding s3:GetEncryptionConfiguration.
   */
  async getDefaultEncryption(
    connection: Connection,
    bucket: string
  ): Promise<{ sseAlgorithm: string; kmsKeyId?: string } | null> {
    const cacheKey = `${connection.id}:${bucket}`
    if (this.defaultEncryption.has(cacheKey)) return this.defaultEncryption.get(cacheKey) ?? null

    let resolved: { sseAlgorithm: string; kmsKeyId?: string } | null = null
    try {
      const client = await this.factory.forBucket(connection, bucket)
      const result = await client.send(new GetBucketEncryptionCommand({ Bucket: bucket }))
      const rule = result.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault
      if (rule?.SSEAlgorithm) {
        resolved = { sseAlgorithm: rule.SSEAlgorithm, kmsKeyId: rule.KMSMasterKeyID }
      }
    } catch {
      // Denied, or nothing configured. Not fatal — see the fallback below.
    }

    // s3:GetEncryptionConfiguration is an administrative permission that ordinary users
    // are rarely granted, so the answer above is often unavailable to exactly the people
    // who need it. An object already in the bucket carries the same answer: HeadObject
    // reports the key it was encrypted with, and reading objects is what these users can
    // do. This is what spares them having to find a key ARN by hand.
    if (!resolved?.kmsKeyId) {
      const inferred = await this.inferEncryptionFromObject(connection, bucket)
      if (inferred) resolved = inferred
    }

    this.defaultEncryption.set(cacheKey, resolved)
    return resolved
  }

  /** Reads the encryption of any one object in the bucket. */
  private async inferEncryptionFromObject(
    connection: Connection,
    bucket: string
  ): Promise<{ sseAlgorithm: string; kmsKeyId?: string } | null> {
    try {
      const client = await this.factory.forBucket(connection, bucket)
      const listing = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 })
      )
      const key = listing.Contents?.[0]?.Key
      if (!key) return null

      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      if (!head.ServerSideEncryption) return null

      return { sseAlgorithm: head.ServerSideEncryption, kmsKeyId: head.SSEKMSKeyId }
    } catch {
      return null
    }
  }

  async listAllKeys(connection: Connection, bucket: string, prefix: string): Promise<S3Object[]> {
    const found: S3Object[] = []
    let token: string | null = null

    do {
      const page: ListingPage = await this.listObjects(connection, {
        bucket,
        prefix,
        token,
        recursive: true
      })
      found.push(...page.objects)
      token = page.nextToken
    } while (token)

    return found
  }

  /**
   * Uploads a file with lib-storage, which switches to multipart automatically above the
   * part size and retries individual parts rather than the whole file.
   */
  async putObject(
    connection: Connection,
    bucket: string,
    key: string,
    localPath: string,
    options: UploadOptions
  ): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    const { size } = await stat(localPath)
    const body = createReadStream(localPath)

    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ...(options.storageClass ? { StorageClass: options.storageClass as never } : {}),
        // Verified by S3 on arrival: a corrupted upload fails rather than lands.
        ChecksumAlgorithm: CHECKSUM_ALGORITHM,
        // Only set encryption headers when a key was given; sending them empty makes
        // S3 reject the request rather than fall back to the bucket default.
        ...(options.kmsKeyId
          ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: options.kmsKeyId }
          : {})
      },
      queueSize: 4,
      partSize: PART_SIZE,
      leavePartsOnError: false
    })

    // httpUploadProgress reports cumulative bytes; total is known from the local file.
    upload.on('httpUploadProgress', (progress) => {
      options.onProgress?.(progress.loaded ?? 0, size)
    })

    const abort = () => void upload.abort()
    options.signal?.addEventListener('abort', abort, { once: true })

    try {
      await upload.done()
    } finally {
      options.signal?.removeEventListener('abort', abort)
      body.destroy()
    }
  }

  /**
   * Streams an object to disk. Never buffers the whole body — a multi-gigabyte object
   * must not have to fit in memory.
   */
  async getObject(
    connection: Connection,
    bucket: string,
    key: string,
    localPath: string,
    options: DownloadOptions
  ): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    const result = await client.send(
      // ChecksumMode makes S3 return the stored checksum, which the SDK then validates
      // against the bytes it received.
      new GetObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }),
      { abortSignal: options.signal }
    )

    if (!result.Body) throw new Error(`S3 returned no content for ${key}.`)

    await mkdir(dirname(localPath), { recursive: true })

    const total = result.ContentLength
    let transferred = 0
    const source = result.Body as Readable
    source.on('data', (chunk: Buffer) => {
      transferred += chunk.length
      options.onProgress?.(transferred, total)
    })

    // pipeline tears down both streams and removes the partial file's handle on failure.
    await pipeline(source, createWriteStream(localPath), { signal: options.signal })
  }

  async deleteObjects(
    connection: Connection,
    bucket: string,
    keys: string[]
  ): Promise<Array<{ key: string; reason: string }>> {
    const client = await this.factory.forBucket(connection, bucket)
    const failures: Array<{ key: string; reason: string }> = []

    // DeleteObjects accepts at most 1000 keys per call.
    for (let index = 0; index < keys.length; index += DELETE_BATCH) {
      const batch = keys.slice(index, index + DELETE_BATCH)
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true }
        })
      )
      for (const error of result.Errors ?? []) {
        failures.push({ key: error.Key ?? '(unknown)', reason: error.Message ?? error.Code ?? 'Refused' })
      }
    }

    return failures
  }

  async copyObject(
    connection: Connection,
    source: { bucket: string; key: string },
    target: { bucket: string; key: string },
    options: { storageClass?: string; kmsKeyId?: string } = {}
  ): Promise<void> {
    // The destination bucket decides which endpoint the request goes to.
    const client = await this.factory.forBucket(connection, target.bucket)
    const kmsKeyId = options.kmsKeyId ?? connection.kmsKeyId

    await client.send(
      new CopyObjectCommand({
        Bucket: target.bucket,
        // CopySource is a URL path, so a key containing spaces or "+" must be encoded.
        CopySource: `${source.bucket}/${encodeURIComponent(source.key).replace(/%2F/g, '/')}`,
        Key: target.key,
        ...(options.storageClass ? { StorageClass: options.storageClass as never } : {}),
        // Changing the class or the key of an object means rewriting it, so the
        // destination's encryption has to be stated again rather than inherited.
        ...(kmsKeyId
          ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: kmsKeyId }
          : {})
      })
    )
  }

  async getTags(
    connection: Connection,
    bucket: string,
    key: string
  ): Promise<Record<string, string>> {
    const client = await this.factory.forBucket(connection, bucket)
    const result = await client.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }))

    return Object.fromEntries(
      (result.TagSet ?? [])
        .filter((tag) => tag.Key !== undefined)
        .map((tag) => [tag.Key as string, tag.Value ?? ''])
    )
  }

  async putTags(
    connection: Connection,
    bucket: string,
    key: string,
    tags: Record<string, string>
  ): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    await client.send(
      new PutObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
        Tagging: { TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) }
      })
    )
  }

  /**
   * Rewrites an object's headers.
   *
   * MetadataDirective REPLACE is what makes this an edit rather than a copy: without it
   * S3 keeps the original headers and the change silently does nothing. Every header has
   * to be restated for the same reason — anything omitted is dropped, not preserved.
   */
  async replaceMetadata(
    connection: Connection,
    bucket: string,
    key: string,
    headers: ObjectHeaders
  ): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)

    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
        Key: key,
        MetadataDirective: 'REPLACE',
        ContentType: headers.contentType,
        CacheControl: headers.cacheControl,
        ContentDisposition: headers.contentDisposition,
        ContentEncoding: headers.contentEncoding,
        ContentLanguage: headers.contentLanguage,
        Metadata: headers.metadata,
        ...(headers.storageClass ? { StorageClass: headers.storageClass as never } : {}),
        ...(connection.kmsKeyId
          ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: connection.kmsKeyId }
          : {})
      })
    )
  }

  async restoreObject(
    connection: Connection,
    bucket: string,
    key: string,
    days: number,
    tier: string
  ): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    await client.send(
      new RestoreObjectCommand({
        Bucket: bucket,
        Key: key,
        RestoreRequest: { Days: days, GlacierJobParameters: { Tier: tier as never } }
      })
    )
  }

  async createBucket(connection: Connection, name: string, region?: string): Promise<void> {
    const target = region ?? connection.region
    const client = this.factory.forConnection(connection, target)

    await client.send(
      new CreateBucketCommand({
        Bucket: name,
        // us-east-1 is the one region that must not be named, or S3 rejects the request.
        ...(target === 'us-east-1'
          ? {}
          : { CreateBucketConfiguration: { LocationConstraint: target as never } })
      })
    )
  }

  async deleteBucket(connection: Connection, name: string): Promise<void> {
    const client = await this.factory.forBucket(connection, name)
    await client.send(new DeleteBucketCommand({ Bucket: name }))
    this.factory.forget(connection.id)
  }

  async createFolder(connection: Connection, bucket: string, key: string): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    // A zero-byte object whose key ends in "/" is the convention every S3 tool reads
    // as an empty folder. S3 itself has no such concept.
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: '',
        // A zero-length body still gets a length, which avoids the SDK's warning about
        // streams of unknown size.
        ContentLength: 0
      })
    )
  }

  async presign(
    connection: Connection,
    bucket: string,
    key: string,
    expiresInSeconds: number
  ): Promise<string> {
    const client = await this.factory.forBucket(connection, bucket)
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: expiresInSeconds
    })
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
