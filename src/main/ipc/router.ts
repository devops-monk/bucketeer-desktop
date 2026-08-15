import { ipcMain } from 'electron'
import type { Result } from '@shared/types'
import { toAppError } from '../core/errors'

/**
 * Wraps ipcMain.handle so every handler answers with a Result.
 *
 * Errors are translated at this one boundary, which keeps try/catch out of the services
 * and guarantees a raw AWS error object — which can carry request metadata and headers —
 * never reaches the renderer.
 */
export class IpcRouter {
  handle<Args extends unknown[], T>(
    channel: string,
    handler: (...args: Args) => Promise<T> | T
  ): void {
    ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
      try {
        return { ok: true, data: await handler(...(args as Args)) }
      } catch (error) {
        return { ok: false, error: toAppError(error) }
      }
    })
  }
}

/** A group of related channels. Registered together at startup. */
export interface IpcModule {
  register(router: IpcRouter): void
}
