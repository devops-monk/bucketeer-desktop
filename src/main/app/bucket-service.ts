import type {
  BucketSettings,
  CopyResult,
  CorsRule,
  CreateBucketRequest,
  DeleteBucketRequest,
  SetStorageClassRequest,
  TransferObjectsRequest
} from '@shared/types'
import { BucketeerError } from '../core/errors'
import type { ConnectionRepository, ObjectStorage } from '../core/ports'

/** S3 bucket names are DNS labels, and the rules are strict enough to check up front. */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

/**
 * Operations on buckets themselves, and on objects moving between them.
 *
 * Separate from ObjectService because the unit of work is different: these act on whole
 * buckets or move things across them, where ObjectService works inside one listing.
 */
export class BucketService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly storage: ObjectStorage
  ) {}

  async settings(connectionId: string, bucket: string): Promise<BucketSettings> {
    return this.storage.getBucketSettings(await this.repository.get(connectionId), bucket)
  }

  /**
   * Replaces or removes the bucket policy.
   *
   * Validated as JSON here, because S3's rejection of malformed policy documents is
   * cryptic, and because a policy is the one setting where a mistake locks everybody —
   * including the person making it — out of the bucket.
   */
  async setPolicy(connectionId: string, bucket: string, policy: string | null): Promise<void> {
    if (policy !== null) {
      let parsed: unknown
      try {
        parsed = JSON.parse(policy)
      } catch {
        throw new BucketeerError('That is not valid JSON.', 'InvalidPolicy')
      }

      const document = parsed as { Statement?: unknown[]; Version?: string }
      if (!document || !Array.isArray(document.Statement)) {
        throw new BucketeerError(
          'A bucket policy needs a Statement array. Nothing has been changed.',
          'InvalidPolicy'
        )
      }
    }

    await this.storage.putBucketPolicy(await this.repository.get(connectionId), bucket, policy)
  }

  /**
   * Replaces the CORS rules.
   *
   * Checked here because a browser's report of a failed CORS request never says which
   * rule was wrong, and an origin with a trailing slash — the commonest mistake — fails
   * silently in a way that takes an afternoon to find.
   */
  async setCors(connectionId: string, bucket: string, rules: CorsRule[] | null): Promise<void> {
    for (const rule of rules ?? []) {
      if (rule.allowedOrigins.length === 0 || rule.allowedMethods.length === 0) {
        throw new BucketeerError(
          'Every CORS rule needs at least one origin and one method.',
          'InvalidCors'
        )
      }
      for (const origin of rule.allowedOrigins) {
        if (origin !== '*' && origin.endsWith('/')) {
          throw new BucketeerError(
            `Origins must not end with a slash: "${origin}" will never match a browser request.`,
            'InvalidCors'
          )
        }
        if (origin !== '*' && !/^https?:\/\//.test(origin)) {
          throw new BucketeerError(
            `Origins must include a scheme: write "https://${origin}" rather than "${origin}".`,
            'InvalidCors'
          )
        }
      }
    }

    await this.storage.putCors(await this.repository.get(connectionId), bucket, rules)
  }

  async setVersioning(connectionId: string, bucket: string, enabled: boolean): Promise<void> {
    await this.storage.setVersioning(await this.repository.get(connectionId), bucket, enabled)
  }

  async create(request: CreateBucketRequest): Promise<void> {
    const name = request.name.trim().toLowerCase()

    // Checked here rather than left to S3, whose error for this is famously unhelpful.
    if (!BUCKET_NAME.test(name)) {
      throw new BucketeerError(
        'Bucket names must be 3 to 63 characters, lowercase, and may contain only letters, numbers, dots and hyphens.',
        'InvalidBucketName'
      )
    }
    if (name.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(name)) {
      throw new BucketeerError(
        'Bucket names cannot contain two adjacent dots or look like an IP address.',
        'InvalidBucketName'
      )
    }

    const connection = await this.repository.get(request.connectionId)
    await this.storage.createBucket(connection, name, request.region)
  }

  /**
   * Deletes a bucket. S3 refuses while any object remains, and that refusal is worth
   * passing through as-is: emptying a bucket is a much larger decision than deleting an
   * empty one, and should be made deliberately rather than as a side effect.
   */
  async remove(request: DeleteBucketRequest): Promise<void> {
    const connection = await this.repository.get(request.connectionId)
    await this.storage.deleteBucket(connection, request.name)
  }

  /**
   * Copies or moves objects and whole folders, within a bucket or across buckets.
   *
   * Server-side throughout: the bytes never travel to this machine, which is what makes
   * moving a large folder practical. A move deletes each source only after its copy
   * succeeded, so an interruption leaves duplicates rather than losing data.
   */
  async copy(request: TransferObjectsRequest): Promise<CopyResult> {
    const connection = await this.repository.get(request.connectionId)

    const items: Array<{ key: string; target: string }> = request.keys.map((key) => ({
      key,
      target: `${request.targetPrefix}${key.split('/').pop() ?? key}`
    }))

    for (const prefix of request.prefixes) {
      const objects = await this.storage.listAllKeys(connection, request.sourceBucket, prefix)
      // Keep the folder itself as the root of what lands, rather than scattering its
      // contents into the destination.
      const parent = prefix.replace(/\/$/, '').split('/').slice(0, -1).join('/')
      const base = parent ? `${parent}/` : ''

      for (const object of objects) {
        items.push({ key: object.key, target: `${request.targetPrefix}${object.key.slice(base.length)}` })
      }
    }

    const sameBucket = request.sourceBucket === request.targetBucket
    const failed: CopyResult['failed'] = []
    const copied: string[] = []

    for (const item of items) {
      if (sameBucket && item.key === item.target) continue
      try {
        await this.storage.copyObject(
          connection,
          { bucket: request.sourceBucket, key: item.key },
          { bucket: request.targetBucket, key: item.target }
        )
        copied.push(item.key)
      } catch (error) {
        failed.push({ key: item.key, reason: error instanceof Error ? error.message : String(error) })
      }
    }

    if (request.move && copied.length > 0) {
      const refused = await this.storage.deleteObjects(connection, request.sourceBucket, copied)
      failed.push(...refused)
    }

    return { copied: copied.length, failed }
  }

  /**
   * Changes the storage class of existing objects.
   *
   * S3 has no "set class" call: the object is copied onto itself with the new class,
   * which is why this is here rather than being a field somewhere.
   */
  async setStorageClass(request: SetStorageClassRequest): Promise<CopyResult> {
    const connection = await this.repository.get(request.connectionId)
    const failed: CopyResult['failed'] = []
    let copied = 0

    for (const key of request.keys) {
      try {
        await this.storage.copyObject(
          connection,
          { bucket: request.bucket, key },
          { bucket: request.bucket, key },
          { storageClass: request.storageClass }
        )
        copied += 1
      } catch (error) {
        failed.push({ key, reason: error instanceof Error ? error.message : String(error) })
      }
    }

    return { copied, failed }
  }
}
