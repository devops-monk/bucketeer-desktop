import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  DeleteBucketCorsCommand,
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketLoggingCommand,
  GetBucketPolicyCommand,
  GetBucketRequestPaymentCommand,
  GetBucketWebsiteCommand,
  PutBucketCorsCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  PutBucketPolicyCommand,
  PutBucketVersioningCommand,
  GetObjectTaggingCommand,
  ListObjectVersionsCommand,
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
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  Bucket,
  BucketSettings,
  Connection,
  CorsRule,
  ListObjectsRequest,
  ListingPage,
  ObjectDetail,
  ObjectHeaders,
  ObjectVersion,
  S3Object
} from '@shared/types'
import type {
  CredentialResolver,
  DownloadOptions,
  ObjectStorage,
  UploadOptions
} from '../../core/ports'
import { RateLimiter, throttle } from '../../app/rate-limiter'
import type { S3ClientFactory } from './client-factory'
import { ResumableUpload, type ResumeState } from './resumable-upload'
import { cleanETag, isFolderMarker, toObject, toPrefix } from './mappers'

const PAGE_SIZE = 1000
/** DeleteObjects accepts 1000 keys per request. */
const DELETE_BATCH = 1000
/** 8 MB parts: large enough to keep request overhead low, small enough to retry cheaply. */
const DEFAULT_PART_SIZE = 8 * 1024 * 1024
/** ObjectStorage backed by the AWS SDK. The only place S3 commands are issued. */
export class S3ObjectStorage implements ObjectStorage {
  /** bucket → its default encryption, including a remembered "none". */
  private readonly defaultEncryption = new Map<
    string,
    { sseAlgorithm: string; kmsKeyId?: string } | null
  >()

  private partSize = DEFAULT_PART_SIZE
  private readonly limiter = new RateLimiter(0)

  constructor(
    private readonly factory: S3ClientFactory,
    private readonly credentials: CredentialResolver
  ) {}

  /**
   * Part size and the shared bandwidth ceiling. The limiter is one object for the whole
   * app: limiting each transfer separately would let three of them use three times the
   * limit.
   */
  applyPreferences(preferences: { partSizeMb: number; bandwidthMbps: number }): void {
    // S3 rejects parts below 5 MB except the last, and 5 GB is its ceiling.
    const megabytes = Math.min(Math.max(5, Math.round(preferences.partSizeMb)), 512)
    this.partSize = megabytes * 1024 * 1024
    this.limiter.setLimit(Math.max(0, preferences.bandwidthMbps) * 1024 * 1024)
  }

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
   * Uploads a file, in parts large enough to resume.
   *
   * Hand-rolled multipart rather than lib-storage, which cannot adopt an existing
   * UploadId — so with it, an interrupted 10 GB upload could only start again from zero.
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

    const uploader = new ResumableUpload(
      client,
      (transferred) => options.onProgress?.(transferred, size),
      (state) => options.onResumeState?.(state)
    )

    await uploader.upload(
      bucket,
      key,
      localPath,
      this.partSize,
      options,
      options.resume as ResumeState | undefined
    )
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

    // pipeline tears down every stream in the chain and closes the partial file on
    // failure, throttle included.
    const sink = createWriteStream(localPath)
    if (this.limiter.enabled) {
      await pipeline(source, throttle(this.limiter), sink, { signal: options.signal })
    } else {
      await pipeline(source, sink, { signal: options.signal })
    }
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

  /**
   * Lists versions and delete markers together, because they are two halves of one
   * history: a delete marker is what makes an object look gone, and seeing it is the
   * only way to understand why an object that exists cannot be found.
   */
  async listVersions(
    connection: Connection,
    bucket: string,
    prefix: string
  ): Promise<ObjectVersion[]> {
    const client = await this.factory.forBucket(connection, bucket)
    const found: ObjectVersion[] = []

    let keyMarker: string | undefined
    let versionMarker: string | undefined

    do {
      const result = await client.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: prefix || undefined,
          KeyMarker: keyMarker,
          VersionIdMarker: versionMarker,
          MaxKeys: PAGE_SIZE
        })
      )

      for (const version of result.Versions ?? []) {
        if (!version.Key || !version.VersionId) continue
        found.push({
          key: version.Key,
          versionId: version.VersionId,
          size: version.Size ?? 0,
          lastModified: version.LastModified?.toISOString(),
          etag: cleanETag(version.ETag),
          storageClass: version.StorageClass,
          isLatest: version.IsLatest ?? false,
          isDeleteMarker: false
        })
      }

      for (const marker of result.DeleteMarkers ?? []) {
        if (!marker.Key || !marker.VersionId) continue
        found.push({
          key: marker.Key,
          versionId: marker.VersionId,
          size: 0,
          lastModified: marker.LastModified?.toISOString(),
          isLatest: marker.IsLatest ?? false,
          isDeleteMarker: true
        })
      }

      keyMarker = result.IsTruncated ? result.NextKeyMarker : undefined
      versionMarker = result.IsTruncated ? result.NextVersionIdMarker : undefined
    } while (keyMarker || versionMarker)

    // Newest first, which is the order people reason about history in.
    return found.sort(
      (a, b) => Date.parse(b.lastModified ?? '') - Date.parse(a.lastModified ?? '')
    )
  }

  /**
   * Restores by copying the old version over the current one.
   *
   * Deliberately additive: the version being replaced stays in the history, so a restore
   * is itself undoable. S3 has no other mechanism — there is no "revert".
   */
  async restoreVersion(
    connection: Connection,
    bucket: string,
    key: string,
    versionId: string
  ): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}?versionId=${versionId}`,
        Key: key,
        ...(connection.kmsKeyId
          ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: connection.kmsKeyId }
          : {})
      })
    )
  }

  async deleteVersion(
    connection: Connection,
    bucket: string,
    key: string,
    versionId: string
  ): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }))
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

  /**
   * Reads the bucket's administrative settings.
   *
   * Each call is made and caught independently: these permissions are granted piecemeal,
   * and one refusal must not hide the settings the user can actually see. A denial is
   * reported as a denial — "not allowed to look" and "not configured" look identical in
   * the response otherwise, and they lead to opposite conclusions when someone is trying
   * to work out why an upload was refused.
   */
  async getBucketSettings(connection: Connection, bucket: string): Promise<BucketSettings> {
    const client = await this.factory.forBucket(connection, bucket)

    const settings: BucketSettings = {
      policy: null,
      policyDenied: false,
      versioning: 'Disabled',
      versioningDenied: false,
      publicAccess: null,
      publicAccessDenied: false,
      encryption: null,
      encryptionDenied: false,
      lifecycle: null,
      lifecycleDenied: false,
      cors: null,
      corsDenied: false,
      logging: null,
      loggingDenied: false,
      website: null,
      websiteDenied: false,
      requesterPays: null,
      requesterPaysDenied: false
    }

    try {
      const result = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }))
      settings.policy = result.Policy ?? null
    } catch (error) {
      // No policy at all is a normal state and reports its own code.
      settings.policyDenied = (error as { name?: string }).name !== 'NoSuchBucketPolicy'
    }

    try {
      const result = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }))
      settings.versioning = (result.Status as BucketSettings['versioning']) ?? 'Disabled'
    } catch {
      settings.versioning = 'Unknown'
      settings.versioningDenied = true
    }

    try {
      const result = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }))
      const block = result.PublicAccessBlockConfiguration
      settings.publicAccess = {
        blockPublicAcls: block?.BlockPublicAcls ?? false,
        ignorePublicAcls: block?.IgnorePublicAcls ?? false,
        blockPublicPolicy: block?.BlockPublicPolicy ?? false,
        restrictPublicBuckets: block?.RestrictPublicBuckets ?? false
      }
    } catch (error) {
      settings.publicAccessDenied =
        (error as { name?: string }).name !== 'NoSuchPublicAccessBlockConfiguration'
    }

    settings.encryption = await this.getDefaultEncryption(connection, bucket)
    settings.encryptionDenied = settings.encryption === null

    // Each of the remaining reads is its own permission, and a bucket normally has most
    // of them unset. "Not configured" answers with a specific code, so only anything
    // else counts as a refusal.
    await Promise.all([
      this.read(
        () => client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })),
        'NoSuchLifecycleConfiguration',
        (result) => {
          settings.lifecycle = (result.Rules ?? []).map((rule) => ({
            id: rule.ID ?? '(unnamed)',
            status: rule.Status ?? 'Unknown',
            prefix: rule.Filter?.Prefix ?? rule.Prefix ?? '',
            expirationDays: rule.Expiration?.Days,
            transitions: (rule.Transitions ?? []).map((transition) => ({
              days: transition.Days,
              storageClass: transition.StorageClass ?? 'Unknown'
            })),
            abortIncompleteAfterDays: rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation,
            noncurrentExpirationDays: rule.NoncurrentVersionExpiration?.NoncurrentDays
          }))
        },
        (denied) => (settings.lifecycleDenied = denied)
      ),

      this.read(
        () => client.send(new GetBucketCorsCommand({ Bucket: bucket })),
        'NoSuchCORSConfiguration',
        (result) => {
          settings.cors = (result.CORSRules ?? []).map((rule) => ({
            allowedOrigins: rule.AllowedOrigins ?? [],
            allowedMethods: rule.AllowedMethods ?? [],
            allowedHeaders: rule.AllowedHeaders ?? [],
            exposeHeaders: rule.ExposeHeaders ?? [],
            maxAgeSeconds: rule.MaxAgeSeconds
          }))
        },
        (denied) => (settings.corsDenied = denied)
      ),

      this.read(
        () => client.send(new GetBucketLoggingCommand({ Bucket: bucket })),
        null,
        (result) => {
          const enabled = result.LoggingEnabled
          settings.logging = enabled?.TargetBucket
            ? { targetBucket: enabled.TargetBucket, targetPrefix: enabled.TargetPrefix ?? '' }
            : null
        },
        (denied) => (settings.loggingDenied = denied)
      ),

      this.read(
        () => client.send(new GetBucketWebsiteCommand({ Bucket: bucket })),
        'NoSuchWebsiteConfiguration',
        (result) => {
          settings.website = {
            indexDocument: result.IndexDocument?.Suffix,
            errorDocument: result.ErrorDocument?.Key
          }
        },
        (denied) => (settings.websiteDenied = denied)
      ),

      this.read(
        () => client.send(new GetBucketRequestPaymentCommand({ Bucket: bucket })),
        null,
        (result) => {
          settings.requesterPays = result.Payer === 'Requester'
        },
        (denied) => (settings.requesterPaysDenied = denied)
      )
    ])

    return settings
  }

  /**
   * Runs one settings read, separating "not configured" from "not allowed".
   *
   * S3 answers an unset configuration with its own error code, so anything else is a
   * refusal — and the two lead to opposite conclusions for someone diagnosing a denial.
   */
  private async read<T>(
    call: () => Promise<T>,
    absentCode: string | null,
    apply: (result: T) => void,
    setDenied: (denied: boolean) => void
  ): Promise<void> {
    try {
      apply(await call())
    } catch (error) {
      const code = (error as { name?: string }).name
      setDenied(absentCode === null ? true : code !== absentCode)
    }
  }

  async putCors(connection: Connection, bucket: string, rules: CorsRule[] | null): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)

    if (rules === null) {
      await client.send(new DeleteBucketCorsCommand({ Bucket: bucket }))
      return
    }

    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: rules.map((rule) => ({
            AllowedOrigins: rule.allowedOrigins,
            AllowedMethods: rule.allowedMethods,
            AllowedHeaders: rule.allowedHeaders,
            ExposeHeaders: rule.exposeHeaders,
            MaxAgeSeconds: rule.maxAgeSeconds
          }))
        }
      })
    )
  }

  async putBucketPolicy(
    connection: Connection,
    bucket: string,
    policy: string | null
  ): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)

    if (policy === null) {
      await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }))
      return
    }
    await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }))
  }

  async setVersioning(connection: Connection, bucket: string, enabled: boolean): Promise<void> {
    const client = await this.factory.forBucket(connection, bucket)
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        // S3 has no "off": versioning is suspended, and existing versions remain.
        VersioningConfiguration: { Status: enabled ? 'Enabled' : 'Suspended' }
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
