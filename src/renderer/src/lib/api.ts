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
    sharedProfiles: () => unwrap(bridge.credentials.sharedProfiles())
  },
  buckets: {
    list: (connectionId: string) => unwrap(bridge.buckets.list(connectionId))
  },
  objects: {
    list: (...args: Parameters<typeof bridge.objects.list>) => unwrap(bridge.objects.list(...args)),
    head: (...args: Parameters<typeof bridge.objects.head>) => unwrap(bridge.objects.head(...args))
  }
}

/** Turns any thrown value into something worth showing a person. */
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
