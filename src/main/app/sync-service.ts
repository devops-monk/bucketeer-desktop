import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import type { SyncPlan, SyncRequest } from '@shared/types'
import type { ConnectionRepository, ObjectStorage } from '../core/ports'
import { compileFilters } from './glob'
import type { TransferService } from './transfer-service'

/**
 * Files below this size have their MD5 computed to settle "changed or not" exactly.
 * Above it, hashing costs more than re-uploading is worth, and size plus modification
 * time is what every sync tool falls back to.
 */
const HASH_LIMIT_BYTES = 16 * 1024 * 1024

/**
 * Compares a local folder against a bucket prefix and uploads only what differs.
 *
 * Deliberately two steps. Analyzing produces a plan the user can read before anything
 * moves, because "sync" is the operation people most fear getting wrong — especially
 * when it can delete. Nothing is uploaded or deleted until the plan is applied.
 */
export class SyncService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly storage: ObjectStorage,
    private readonly transfers: TransferService
  ) {}

  /** Works out what would change, without changing anything. */
  async analyze(request: SyncRequest): Promise<SyncPlan> {
    const connection = await this.repository.get(request.connectionId)
    const matches = compileFilters({ include: request.include, exclude: request.exclude })

    const local = await walk(request.localPath)
    const remote = await this.storage.listAllKeys(connection, request.bucket, request.prefix)

    const remoteByKey = new Map(remote.map((object) => [object.key, object]))
    const plan: SyncPlan = {
      upload: [],
      unchanged: 0,
      filtered: 0,
      deleteRemote: [],
      uploadBytes: 0
    }

    const seen = new Set<string>()

    for (const file of local) {
      if (!matches(file.relativePath)) {
        plan.filtered += 1
        continue
      }

      const key = `${request.prefix}${file.relativePath}`
      seen.add(key)
      const existing = remoteByKey.get(key)

      if (!existing) {
        plan.upload.push({ localPath: file.path, key, size: file.size, reason: 'new' })
        plan.uploadBytes += file.size
        continue
      }

      if (await differs(file, existing)) {
        plan.upload.push({ localPath: file.path, key, size: file.size, reason: 'changed' })
        plan.uploadBytes += file.size
        continue
      }

      plan.unchanged += 1
    }

    if (request.deleteRemote) {
      for (const object of remote) {
        if (seen.has(object.key)) continue
        // A remote-only file still has to pass the filters, or excluding a folder from
        // the sync would quietly mark everything in it for deletion.
        const relativePath = object.key.slice(request.prefix.length)
        if (!matches(relativePath)) continue
        plan.deleteRemote.push({ key: object.key, size: object.size })
      }
    }

    return plan
  }

  /**
   * Carries out a plan: uploads through the ordinary transfer queue, so a sync is
   * visible, cancellable and encrypted exactly like any other upload.
   */
  async apply(request: SyncRequest, plan: SyncPlan): Promise<{ queued: number; deleted: number }> {
    const connection = await this.repository.get(request.connectionId)

    let deleted = 0
    if (plan.deleteRemote.length > 0) {
      const failures = await this.storage.deleteObjects(
        connection,
        request.bucket,
        plan.deleteRemote.map((entry) => entry.key)
      )
      deleted = plan.deleteRemote.length - failures.length
    }

    // Uploaded one at a time by path so keys keep the folder structure the plan worked
    // out, rather than being re-derived from a directory walk.
    for (const item of plan.upload) {
      await this.transfers.uploadExact(
        request.connectionId,
        request.bucket,
        [{ localPath: item.localPath, key: item.key, size: item.size }],
        request.encryption
      )
    }

    return { queued: plan.upload.length, deleted }
  }
}

interface LocalFile {
  path: string
  /** Path relative to the sync root, always with forward slashes. */
  relativePath: string
  size: number
  modified: Date
}

/** Every file beneath a directory, with the paths a sync compares on. */
async function walk(root: string): Promise<LocalFile[]> {
  const found: LocalFile[] = []

  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile()) {
        const info = await stat(path)
        found.push({
          path,
          // Windows separators would produce keys with backslashes in them.
          relativePath: relative(root, path).split(sep).join(posix.sep),
          size: info.size,
          modified: info.mtime
        })
      }
    }
  }

  await visit(root)
  return found
}

/**
 * Decides whether a local file differs from the object already in the bucket.
 *
 * Size first, because it settles most cases for nothing. Then the ETag, which for a
 * single-part upload is the MD5 of the contents and therefore exact — but only for files
 * small enough that hashing is cheaper than re-uploading. Multipart ETags carry a "-"
 * and are not a hash of the whole object, so they are no use for comparison and the
 * fallback is modification time.
 */
async function differs(
  file: LocalFile,
  remote: { size: number; etag?: string; lastModified?: string }
): Promise<boolean> {
  if (file.size !== remote.size) return true

  const etag = remote.etag
  if (etag && !etag.includes('-') && file.size <= HASH_LIMIT_BYTES) {
    return (await md5(file.path)) !== etag
  }

  // Only a local file that is strictly newer counts as changed: equal timestamps, or a
  // remote object uploaded after the local file was written, are treated as in sync.
  const remoteTime = remote.lastModified ? Date.parse(remote.lastModified) : 0
  return file.modified.getTime() > remoteTime + 1000
}

function md5(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}
