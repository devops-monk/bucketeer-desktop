import type {
  CreateFolderRequest,
  ObjectHeaders,
  ObjectVersion,
  RestoreRequest,
  VersionActionRequest,
  DeleteRequest,
  DeleteResult,
  PresignRequest,
  RenameRequest
} from '@shared/types'
import { BucketeerError } from '../core/errors'
import type { ConnectionRepository, ObjectStorage } from '../core/ports'

/** Presigned links are capped at seven days by SigV4 itself. */
const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60

/** Operations that change what is in a bucket, as opposed to reading it. */
export class ObjectService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly storage: ObjectStorage
  ) {}

  /**
   * Deletes objects and, recursively, everything beneath the given prefixes.
   *
   * Prefixes are expanded here rather than in the adapter so the caller gets a single
   * honest count of what was removed and what S3 refused.
   */
  async remove(request: DeleteRequest): Promise<DeleteResult> {
    const connection = await this.repository.get(request.connectionId)

    const keys = [...request.keys]
    for (const prefix of request.prefixes) {
      const objects = await this.storage.listAllKeys(connection, request.bucket, prefix)
      keys.push(...objects.map((object) => object.key))
      // The folder marker itself is not returned by a listing of its own prefix.
      keys.push(prefix)
    }

    if (keys.length === 0) return { deleted: 0, failed: [] }

    const failed = await this.storage.deleteObjects(connection, request.bucket, keys)
    return { deleted: keys.length - failed.length, failed }
  }

  /**
   * Renames an object by copying it to the new key and deleting the old one — S3 has no
   * move. The delete only runs if the copy succeeded, so a failure cannot lose data.
   */
  async rename(request: RenameRequest): Promise<void> {
    if (!request.targetKey.trim()) {
      throw new BucketeerError('A name is required.', 'InvalidName')
    }
    if (request.targetKey === request.sourceKey) return

    const connection = await this.repository.get(request.connectionId)
    await this.storage.copyObject(
      connection,
      { bucket: request.bucket, key: request.sourceKey },
      { bucket: request.bucket, key: request.targetKey }
    )

    const failed = await this.storage.deleteObjects(connection, request.bucket, [request.sourceKey])
    if (failed.length > 0) {
      throw new BucketeerError(
        `Copied to the new name, but the original could not be removed: ${failed[0].reason}`,
        'RenameIncomplete'
      )
    }
  }

  async createFolder(request: CreateFolderRequest): Promise<void> {
    const name = request.name.trim().replace(/^\/+|\/+$/g, '')
    if (!name) throw new BucketeerError('A folder name is required.', 'InvalidName')
    if (name.includes('/')) {
      throw new BucketeerError('Folder names cannot contain "/".', 'InvalidName')
    }

    const connection = await this.repository.get(request.connectionId)
    await this.storage.createFolder(connection, request.bucket, `${request.prefix}${name}/`)
  }

  async versions(connectionId: string, bucket: string, key: string): Promise<ObjectVersion[]> {
    // Prefixed by the exact key, then filtered: S3 lists by prefix, so "reports/a.csv"
    // would otherwise also return "reports/a.csv.bak".
    const versions = await this.storage.listVersions(
      await this.repository.get(connectionId),
      bucket,
      key
    )
    return versions.filter((version) => version.key === key)
  }

  async restoreVersion(request: VersionActionRequest): Promise<void> {
    await this.storage.restoreVersion(
      await this.repository.get(request.connectionId),
      request.bucket,
      request.key,
      request.versionId
    )
  }

  /**
   * Deletes one version for good.
   *
   * The ordinary delete on a versioned bucket only adds a delete marker, so the data is
   * still there and recoverable. This is the one that is not.
   */
  async deleteVersion(request: VersionActionRequest): Promise<void> {
    await this.storage.deleteVersion(
      await this.repository.get(request.connectionId),
      request.bucket,
      request.key,
      request.versionId
    )
  }

  async tags(connectionId: string, bucket: string, key: string): Promise<Record<string, string>> {
    return this.storage.getTags(await this.repository.get(connectionId), bucket, key)
  }

  /**
   * Replaces an object's tags. S3 has no partial update: the set sent becomes the set
   * stored, which is why the editor sends every tag rather than a change.
   */
  async setTags(
    connectionId: string,
    bucket: string,
    key: string,
    tags: Record<string, string>
  ): Promise<void> {
    for (const [name, value] of Object.entries(tags)) {
      if (!name.trim()) throw new BucketeerError('Tag names cannot be empty.', 'InvalidTag')
      if (name.length > 128 || value.length > 256) {
        throw new BucketeerError(
          'Tag names are limited to 128 characters and values to 256.',
          'InvalidTag'
        )
      }
    }
    if (Object.keys(tags).length > 10) {
      throw new BucketeerError('S3 allows at most 10 tags per object.', 'InvalidTag')
    }

    await this.storage.putTags(await this.repository.get(connectionId), bucket, key, tags)
  }

  async setHeaders(
    connectionId: string,
    bucket: string,
    key: string,
    headers: ObjectHeaders
  ): Promise<void> {
    await this.storage.replaceMetadata(
      await this.repository.get(connectionId),
      bucket,
      key,
      headers
    )
  }

  /**
   * Asks for archived objects to be made readable again.
   *
   * Restoring is not instant and not free: Glacier takes minutes to hours depending on
   * tier, Deep Archive up to twelve. The request only starts the process — progress is
   * read back from the object's own restore status.
   */
  async restore(request: RestoreRequest): Promise<{ started: number; failed: Array<{ key: string; reason: string }> }> {
    const connection = await this.repository.get(request.connectionId)
    const failed: Array<{ key: string; reason: string }> = []
    let started = 0

    for (const key of request.keys) {
      try {
        await this.storage.restoreObject(connection, request.bucket, key, request.days, request.tier)
        started += 1
      } catch (error) {
        failed.push({ key, reason: error instanceof Error ? error.message : String(error) })
      }
    }

    return { started, failed }
  }

  async presign(request: PresignRequest): Promise<string> {
    if (request.expiresInSeconds < 1 || request.expiresInSeconds > MAX_PRESIGN_SECONDS) {
      throw new BucketeerError(
        'Links can be valid for between one second and seven days.',
        'InvalidExpiry'
      )
    }

    const connection = await this.repository.get(request.connectionId)
    return this.storage.presign(connection, request.bucket, request.key, request.expiresInSeconds)
  }
}
