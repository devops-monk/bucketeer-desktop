import type {
  CreateFolderRequest,
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
