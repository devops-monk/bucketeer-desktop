import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  CopyObjectCommand,
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
      new GetObjectCommand({ Bucket: bucket, Key: key }),
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
    bucket: string,
    sourceKey: string,
    targetKey: string
  ): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        // CopySource is a URL path, so a key containing spaces or "+" must be encoded.
        CopySource: `${bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`,
        Key: targetKey,
        ...(connection.kmsKeyId
          ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: connection.kmsKeyId }
          : {})
      })
    )
  }

  async createFolder(connection: Connection, bucket: string, key: string): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    // A zero-byte object whose key ends in "/" is the convention every S3 tool reads
    // as an empty folder. S3 itself has no such concept.
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: '' }))
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
