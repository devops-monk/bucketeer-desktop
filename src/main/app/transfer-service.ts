import { readdir, stat } from 'node:fs/promises'
import { basename, join, posix, relative, sep } from 'node:path'
import type { DownloadRequest, Transfer, UploadRequest } from '@shared/types'
import type {
  Clock,
  ConnectionRepository,
  EventBroadcaster,
  IdGenerator,
  ObjectStorage
} from '../core/ports'
import { TaskQueue } from './transfer-queue'

/** How many files move at once. Enough to saturate a link without starving the UI. */
const CONCURRENCY = 3
/** Progress is throttled to this interval, per transfer, before crossing IPC. */
const PROGRESS_INTERVAL_MS = 120

/**
 * Owns the transfer queue: expands what the user selected into individual files,
 * schedules them, tracks progress, and reports the whole queue to the UI.
 *
 * Transfers never reject into the caller. A failure becomes a `failed` row with a
 * message, because the user asked for twenty files and one being denied should not
 * abandon the other nineteen.
 */
export class TransferService {
  private readonly transfers = new Map<string, Transfer>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly queue = new TaskQueue(CONCURRENCY)
  /** Coalesces bursts of progress updates into one broadcast per tick. */
  private flushHandle: NodeJS.Timeout | null = null

  constructor(
    private readonly repository: ConnectionRepository,
    private readonly storage: ObjectStorage,
    private readonly broadcaster: EventBroadcaster,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  list(): Transfer[] {
    return [...this.transfers.values()]
  }

  /**
   * Queues an upload. Directories are walked, so dropping a folder uploads its whole
   * tree with the folder structure preserved as key prefixes.
   *
   * Returns the number of files queued; the transfers themselves run in the background.
   */
  async upload(request: UploadRequest): Promise<number> {
    const connection = await this.repository.get(request.connectionId)
    const encryption = request.encryption ?? { mode: 'auto' }

    let kmsKeyId: string | undefined
    if (encryption.mode === 'kms') {
      kmsKeyId = encryption.kmsKeyId
    } else if (encryption.mode === 'auto') {
      kmsKeyId = connection.kmsKeyId

      // Fall back to the bucket's own default key. Buckets that mandate SSE-KMS through
      // a policy reject uploads that omit the headers, even though default encryption
      // would have applied the very same key — the policy is evaluated on the request,
      // not the result. Reading the default spares the user looking the ARN up by hand.
      if (!kmsKeyId) {
        const fallback = await this.storage.getDefaultEncryption(connection, request.bucket)
        if (fallback?.sseAlgorithm === 'aws:kms' && fallback.kmsKeyId) kmsKeyId = fallback.kmsKeyId
      }
    }

    const files: Array<{ localPath: string; key: string; size: number }> = []
    for (const path of request.paths) {
      files.push(...(await expand(path, request.prefix)))
    }

    for (const file of files) {
      const transfer: Transfer = {
        id: this.ids.next(),
        kind: 'upload',
        name: basename(file.localPath),
        bucket: request.bucket,
        key: file.key,
        localPath: file.localPath,
        size: file.size,
        transferred: 0,
        status: 'queued',
        kmsKeyId
      }
      this.track(transfer)

      void this.execute(transfer, (controller) =>
        this.storage.putObject(connection, request.bucket, file.key, file.localPath, {
          kmsKeyId,
          signal: controller.signal,
          onProgress: (transferred, total) => this.progress(transfer.id, transferred, total)
        })
      )
    }

    this.flush()
    return files.length
  }

  /**
   * Queues a download. Selected prefixes are expanded recursively and their structure
   * is recreated as folders under the destination.
   */
  async download(request: DownloadRequest): Promise<number> {
    const connection = await this.repository.get(request.connectionId)

    const targets: Array<{ key: string; localPath: string; size: number }> = request.keys.map(
      (key) => ({
        key,
        localPath: join(request.destination, basename(key)),
        size: 0
      })
    )

    for (const prefix of request.prefixes) {
      const objects = await this.storage.listAllKeys(connection, request.bucket, prefix)
      // Root the copy at the prefix's own folder name, so downloading "logs/2026/"
      // produces a "2026" directory rather than scattering files into the destination.
      const parent = prefix.replace(/\/$/, '').split('/').slice(0, -1).join('/')
      const base = parent ? `${parent}/` : ''

      for (const object of objects) {
        targets.push({
          key: object.key,
          localPath: join(request.destination, ...object.key.slice(base.length).split('/')),
          size: object.size
        })
      }
    }

    for (const target of targets) {
      const transfer: Transfer = {
        id: this.ids.next(),
        kind: 'download',
        name: basename(target.key),
        bucket: request.bucket,
        key: target.key,
        localPath: target.localPath,
        size: target.size,
        transferred: 0,
        status: 'queued'
      }
      this.track(transfer)

      void this.execute(transfer, (controller) =>
        this.storage.getObject(connection, request.bucket, target.key, target.localPath, {
          signal: controller.signal,
          onProgress: (transferred, total) => this.progress(transfer.id, transferred, total)
        })
      )
    }

    this.flush()
    return targets.length
  }

  cancel(id: string): void {
    const transfer = this.transfers.get(id)
    if (!transfer) return

    if (transfer.status === 'queued' || transfer.status === 'running') {
      this.controllers.get(id)?.abort()
      this.update(id, { status: 'cancelled', finishedAt: this.clock.nowIso() })
    }
  }

  /** Clears finished rows so the panel shows only what is still in flight. */
  clearFinished(): void {
    for (const [id, transfer] of this.transfers) {
      if (transfer.status !== 'queued' && transfer.status !== 'running') {
        this.transfers.delete(id)
        this.controllers.delete(id)
      }
    }
    this.flush()
  }

  /** Aborts everything in flight, for shutdown. */
  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    if (this.flushHandle) clearTimeout(this.flushHandle)
  }

  private track(transfer: Transfer): void {
    this.transfers.set(transfer.id, transfer)
  }

  private async execute(
    transfer: Transfer,
    work: (controller: AbortController) => Promise<void>
  ): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(transfer.id, controller)

    await this.queue.run(async () => {
      // The user may have cancelled while this sat in the queue.
      if (this.transfers.get(transfer.id)?.status === 'cancelled') return

      this.update(transfer.id, { status: 'running', startedAt: this.clock.nowIso() })
      try {
        await work(controller)
        this.update(transfer.id, {
          status: 'done',
          finishedAt: this.clock.nowIso(),
          transferred: this.transfers.get(transfer.id)?.size ?? 0
        })
      } catch (error) {
        // An abort surfaces as an error; it is a cancellation, not a failure.
        if (controller.signal.aborted) {
          this.update(transfer.id, { status: 'cancelled', finishedAt: this.clock.nowIso() })
          return
        }
        this.update(transfer.id, {
          status: 'failed',
          error: explainFailure(error, transfer),
          finishedAt: this.clock.nowIso()
        })
      } finally {
        this.controllers.delete(transfer.id)
      }
    })
  }

  private progress(id: string, transferred: number, total?: number): void {
    const transfer = this.transfers.get(id)
    if (!transfer) return

    transfer.transferred = transferred
    if (total && !transfer.size) transfer.size = total
    this.scheduleFlush()
  }

  private update(id: string, patch: Partial<Transfer>): void {
    const transfer = this.transfers.get(id)
    if (!transfer) return

    this.transfers.set(id, { ...transfer, ...patch })
    this.flush()
  }

  /**
   * Progress fires hundreds of times a second across a batch. Without throttling it
   * floods the IPC channel and the renderer spends its time re-rendering a list.
   */
  private scheduleFlush(): void {
    if (this.flushHandle) return
    this.flushHandle = setTimeout(() => {
      this.flushHandle = null
      this.broadcaster.transfersChanged(this.list())
    }, PROGRESS_INTERVAL_MS)
  }

  private flush(): void {
    if (this.flushHandle) {
      clearTimeout(this.flushHandle)
      this.flushHandle = null
    }
    this.broadcaster.transfersChanged(this.list())
  }
}

/**
 * Adds the cause to a transfer failure where AWS's own message states the rule but not
 * the reason it was broken.
 *
 * The case that matters: buckets commonly carry a policy denying any PutObject that is
 * not encrypted with one specific KMS key. AWS reports that as a bare "explicit deny in
 * a resource-based policy", which reads like a permissions problem and sends people to
 * their IAM role — when the actual fix is one field on the connection.
 */
function explainFailure(error: unknown, transfer: Transfer): string {
  const message = error instanceof Error ? error.message : String(error)

  const denied = /explicit deny|AccessDenied|not authorized/i.test(message)
  if (transfer.kind === 'upload' && denied && !transfer.kmsKeyId) {
    return `${message}\n\nThis upload sent no encryption headers: the connection has no KMS key, and the bucket's default encryption could not be read — that call needs s3:GetEncryptionConfiguration. Buckets whose policy mandates SSE-KMS deny such uploads. Set "KMS key for uploads" on the connection to the key's full ARN.`
  }

  if (transfer.kind === 'upload' && denied && transfer.kmsKeyId) {
    return `${message}\n\nThis upload used KMS key "${transfer.kmsKeyId}". If the bucket policy requires a specific key, the connection must name that key by its full ARN — an alias or key id will not match a policy written against an ARN.`
  }

  return message
}

/**
 * Turns a local path into the files to upload and the keys they land on. A directory
 * contributes its whole tree, with local separators translated to "/" so the structure
 * survives on Windows.
 */
async function expand(
  path: string,
  prefix: string
): Promise<Array<{ localPath: string; key: string; size: number }>> {
  const info = await stat(path)

  if (info.isFile()) {
    return [{ localPath: path, key: `${prefix}${basename(path)}`, size: info.size }]
  }
  if (!info.isDirectory()) return []

  const root = basename(path)
  const found: Array<{ localPath: string; key: string; size: number }> = []

  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(child)
      } else if (entry.isFile()) {
        const relativePath = relative(path, child).split(sep).join(posix.sep)
        found.push({
          localPath: child,
          key: `${prefix}${root}/${relativePath}`,
          size: (await stat(child)).size
        })
      }
    }
  }

  await walk(path)
  return found
}
