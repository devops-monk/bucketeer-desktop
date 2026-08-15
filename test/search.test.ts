import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Connection, SearchUpdate } from '@shared/types'
import { SearchService } from '../src/main/app/search-service'
import { createCredentialResolver } from '../src/main/infra/credentials/resolver'
import { S3ClientFactory } from '../src/main/infra/s3/client-factory'
import { S3ObjectStorage } from '../src/main/infra/s3/s3-object-storage'
import { startFakeS3, type FakeS3 } from './fake-s3'

/**
 * Search walks every key, which is the expensive part and the part worth getting right:
 * missing a match is a wrong answer, and never finishing is worse.
 */

let server: FakeS3
let storage: S3ObjectStorage
let search: SearchService
let updates: SearchUpdate[]

const connection = (server: FakeS3): Connection => ({
  id: 'test',
  name: 'Fake S3',
  region: 'eu-west-1',
  endpoint: server.url,
  forcePathStyle: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  credentials: { kind: 'access-key', accessKeyId: 'test', secretAccessKey: 'secret' }
})

/** Waits for the final update, so assertions never race the walk. */
async function finished(): Promise<SearchUpdate> {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const last = updates.at(-1)
    if (last?.done) return last
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Search never finished')
}

beforeEach(async () => {
  updates = []
  server = await startFakeS3({
    buckets: ['search-bucket'],
    objects: {
      'search-bucket/reports/2026/january-summary.csv': 'a',
      'search-bucket/reports/2026/february-summary.csv': 'b',
      'search-bucket/reports/2025/january-summary.csv': 'c',
      'search-bucket/invoices/2026/january-invoice.pdf': 'd',
      'search-bucket/notes.txt': 'e'
    }
  })

  const resolver = createCredentialResolver()
  storage = new S3ObjectStorage(new S3ClientFactory(resolver), resolver)
  search = new SearchService(
    { get: async () => connection(server) } as never,
    storage,
    { searchUpdated: (update: SearchUpdate) => updates.push(update) } as never,
    { next: () => 'search-1' }
  )
})

afterEach(async () => {
  search.dispose()
  storage.dispose()
  await server.close()
})

describe('search', () => {
  it('finds every matching key beneath the starting prefix', async () => {
    search.start({ connectionId: 'test', bucket: 'search-bucket', prefix: '', query: 'january' })
    const result = await finished()

    expect(result.matches.map((match) => match.key).sort()).toEqual([
      'invoices/2026/january-invoice.pdf',
      'reports/2025/january-summary.csv',
      'reports/2026/january-summary.csv'
    ])
    expect(result.scanned).toBe(5)
  })

  it('searches only below the prefix it was given', async () => {
    search.start({
      connectionId: 'test',
      bucket: 'search-bucket',
      prefix: 'reports/2026/',
      query: 'summary'
    })
    const result = await finished()

    expect(result.matches).toHaveLength(2)
    // The 2025 copy is outside the starting point and must not be examined at all.
    expect(result.scanned).toBe(2)
  })

  it('treats a query with wildcards as a pattern over the whole key', async () => {
    search.start({
      connectionId: 'test',
      bucket: 'search-bucket',
      prefix: '',
      query: 'reports/*/january*'
    })
    const result = await finished()

    expect(result.matches.map((match) => match.key).sort()).toEqual([
      'reports/2025/january-summary.csv',
      'reports/2026/january-summary.csv'
    ])
  })

  it('ignores case unless asked not to', async () => {
    search.start({ connectionId: 'test', bucket: 'search-bucket', prefix: '', query: 'JANUARY' })
    expect((await finished()).matches).toHaveLength(3)

    updates = []
    search.start({
      connectionId: 'test',
      bucket: 'search-bucket',
      prefix: '',
      query: 'JANUARY',
      caseSensitive: true
    })
    expect((await finished()).matches).toHaveLength(0)
  })

  it('reports a finished walk that matched nothing', async () => {
    search.start({ connectionId: 'test', bucket: 'search-bucket', prefix: '', query: 'nothing' })
    const result = await finished()

    expect(result.done).toBe(true)
    expect(result.matches).toEqual([])
    expect(result.error).toBeUndefined()
  })

  it('reports a failure rather than hanging', async () => {
    search.start({ connectionId: 'test', bucket: 'missing-bucket', prefix: '', query: 'x' })
    const result = await finished()

    expect(result.done).toBe(true)
    expect(result.error).toBeTruthy()
  })

  it('stops when cancelled', async () => {
    const id = search.start({
      connectionId: 'test',
      bucket: 'search-bucket',
      prefix: '',
      query: 'january'
    })
    search.cancel(id)

    const result = await finished()
    expect(result.done).toBe(true)
    expect(result.cancelled).toBe(true)
  })
})
