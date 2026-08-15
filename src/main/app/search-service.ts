import type { S3Object, SearchRequest, SearchUpdate } from '@shared/types'
import type { ConnectionRepository, EventBroadcaster, IdGenerator, ObjectStorage } from '../core/ports'

/** Results are batched to the UI at most this often, however fast keys arrive. */
const REPORT_INTERVAL_MS = 250
/** A ceiling on what is held in memory. A search returning more than this needs refining. */
const MAX_MATCHES = 2000

/**
 * Finds objects by name anywhere under a prefix.
 *
 * S3 cannot filter by anything but a prefix, so this is a walk: every key under the
 * starting point is listed and matched here. That is unavoidable, and it means a search
 * of a large bucket takes minutes and thousands of requests — so it streams results as
 * it goes, reports how far it has got, and can be stopped at any point.
 *
 * Nothing is accumulated beyond the matches themselves. A bucket with ten million keys
 * is walked a page at a time and never held in memory.
 */
export class SearchService {
  private readonly cancellations = new Map<string, AbortController>()

  constructor(
    private readonly repository: ConnectionRepository,
    private readonly storage: ObjectStorage,
    private readonly broadcaster: EventBroadcaster,
    private readonly ids: IdGenerator
  ) {}

  /** Starts a search and returns its id. Results arrive as broadcasts. */
  start(request: SearchRequest): string {
    const id = this.ids.next()
    const controller = new AbortController()
    this.cancellations.set(id, controller)

    void this.run(id, request, controller.signal)
    return id
  }

  cancel(id: string): void {
    this.cancellations.get(id)?.abort()
  }

  dispose(): void {
    for (const controller of this.cancellations.values()) controller.abort()
    this.cancellations.clear()
  }

  private async run(id: string, request: SearchRequest, signal: AbortSignal): Promise<void> {
    const matches: S3Object[] = []
    let scanned = 0
    let lastReport = 0

    const report = (done: boolean, extra: Partial<SearchUpdate> = {}): void => {
      lastReport = Date.now()
      this.broadcaster.searchUpdated({
        id,
        scanned,
        matches: [...matches],
        done,
        ...extra
      })
    }

    try {
      const connection = await this.repository.get(request.connectionId)
      const matcher = build(request)

      let token: string | null = null
      do {
        if (signal.aborted) {
          report(true, { cancelled: true })
          return
        }

        const page = await this.storage.listObjects(connection, {
          bucket: request.bucket,
          prefix: request.prefix,
          token,
          recursive: true
        })

        scanned += page.objects.length
        for (const object of page.objects) {
          if (matcher(object.key)) matches.push(object)
        }

        if (matches.length >= MAX_MATCHES) {
          report(true, { truncated: true })
          return
        }

        // Throttled: a bucket answering a thousand keys per page would otherwise
        // re-render the results list faster than anyone can read it.
        if (Date.now() - lastReport > REPORT_INTERVAL_MS) report(false)
        token = page.nextToken
      } while (token)

      report(true)
    } catch (error) {
      report(true, { error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.cancellations.delete(id)
    }
  }
}

/**
 * Builds the match test.
 *
 * A query containing * or ? is treated as a pattern against the whole key; anything else
 * is a plain substring of it, which is what people mean when they type a filename into a
 * search box.
 */
function build(request: SearchRequest): (key: string) => boolean {
  const query = request.caseSensitive ? request.query : request.query.toLowerCase()
  const prepare = (key: string): string => (request.caseSensitive ? key : key.toLowerCase())

  if (!/[*?]/.test(query)) {
    return (key) => prepare(key).includes(query)
  }

  const pattern = new RegExp(
    `^${query
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`
  )
  return (key) => pattern.test(prepare(key))
}
