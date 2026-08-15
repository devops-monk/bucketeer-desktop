import type { AppError, Result } from '@shared/types'

/**
 * Renderer-side adapter over the preload bridge.
 *
 * Unwraps the Result envelope so components can use ordinary async/await and a single
 * catch, while keeping the structured error detail the main process worked out.
 */
export class ApiError extends Error {
  readonly code?: string
  readonly credentialsExpired: boolean

  constructor(error: AppError) {
    super(error.message)
    this.name = 'ApiError'
    this.code = error.code
    this.credentialsExpired = error.credentialsExpired ?? false
  }
}

async function unwrap<T>(pending: Promise<Result<T>>): Promise<T> {
  const result = await pending
  if (!result.ok) throw new ApiError(result.error)
  return result.data
}

const bridge = window.bucketeer

export const api = {
  connections: {
    list: () => unwrap(bridge.connections.list()),
    save: (...args: Parameters<typeof bridge.connections.save>) =>
      unwrap(bridge.connections.save(...args)),
    remove: (id: string) => unwrap(bridge.connections.remove(id)),
    test: (id: string) => unwrap(bridge.connections.test(id)),
    secretsAvailable: () => unwrap(bridge.connections.secretsAvailable())
  },
  credentials: {
    sharedProfiles: () => unwrap(bridge.credentials.sharedProfiles()),
    ssoLogin: (profileName: string) => unwrap(bridge.credentials.ssoLogin(profileName)),
    kmsKeys: (connectionId: string) => unwrap(bridge.credentials.kmsKeys(connectionId)),
    onSsoPending: bridge.credentials.onSsoPending
  },
  buckets: {
    list: (connectionId: string) => unwrap(bridge.buckets.list(connectionId)),
    encryption: (connectionId: string, bucket: string) =>
      unwrap(bridge.buckets.encryption(connectionId, bucket)),
    create: (...args: Parameters<typeof bridge.buckets.create>) =>
      unwrap(bridge.buckets.create(...args)),
    remove: (...args: Parameters<typeof bridge.buckets.remove>) =>
      unwrap(bridge.buckets.remove(...args))
  },
  objects: {
    list: (...args: Parameters<typeof bridge.objects.list>) => unwrap(bridge.objects.list(...args)),
    head: (...args: Parameters<typeof bridge.objects.head>) => unwrap(bridge.objects.head(...args)),
    remove: (...args: Parameters<typeof bridge.objects.remove>) =>
      unwrap(bridge.objects.remove(...args)),
    rename: (...args: Parameters<typeof bridge.objects.rename>) =>
      unwrap(bridge.objects.rename(...args)),
    createFolder: (...args: Parameters<typeof bridge.objects.createFolder>) =>
      unwrap(bridge.objects.createFolder(...args)),
    presign: (...args: Parameters<typeof bridge.objects.presign>) =>
      unwrap(bridge.objects.presign(...args)),
    copy: (...args: Parameters<typeof bridge.objects.copy>) => unwrap(bridge.objects.copy(...args)),
    setStorageClass: (...args: Parameters<typeof bridge.objects.setStorageClass>) =>
      unwrap(bridge.objects.setStorageClass(...args)),
    tags: (...args: Parameters<typeof bridge.objects.tags>) => unwrap(bridge.objects.tags(...args)),
    setTags: (...args: Parameters<typeof bridge.objects.setTags>) =>
      unwrap(bridge.objects.setTags(...args)),
    setHeaders: (...args: Parameters<typeof bridge.objects.setHeaders>) =>
      unwrap(bridge.objects.setHeaders(...args)),
    restore: (...args: Parameters<typeof bridge.objects.restore>) =>
      unwrap(bridge.objects.restore(...args))
  },
  sync: {
    analyze: (...args: Parameters<typeof bridge.sync.analyze>) =>
      unwrap(bridge.sync.analyze(...args)),
    apply: (...args: Parameters<typeof bridge.sync.apply>) => unwrap(bridge.sync.apply(...args))
  },
  transfers: {
    upload: (...args: Parameters<typeof bridge.transfers.upload>) =>
      unwrap(bridge.transfers.upload(...args)),
    download: (...args: Parameters<typeof bridge.transfers.download>) =>
      unwrap(bridge.transfers.download(...args)),
    list: () => unwrap(bridge.transfers.list()),
    cancel: (id: string) => unwrap(bridge.transfers.cancel(id)),
    clearFinished: () => unwrap(bridge.transfers.clearFinished()),
    onChanged: bridge.transfers.onChanged
  },
  app: {
    version: () => unwrap(bridge.app.version()),
    getTheme: () => unwrap(bridge.app.getTheme()),
    setTheme: (...args: Parameters<typeof bridge.app.setTheme>) =>
      unwrap(bridge.app.setTheme(...args)),
    downloadsFolder: () => unwrap(bridge.app.downloadsFolder()),
    revealFile: (path: string) => unwrap(bridge.app.revealFile(path))
  },
  dialog: {
    pickFiles: () => unwrap(bridge.dialog.pickFiles()),
    pickDirectory: () => unwrap(bridge.dialog.pickDirectory())
  }
}

/** Turns any thrown value into something worth showing a person. */
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
