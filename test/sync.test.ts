import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Connection } from '@shared/types'
import { compileFilters } from '../src/main/app/glob'
import { SyncService } from '../src/main/app/sync-service'
import { createCredentialResolver } from '../src/main/infra/credentials/resolver'
import { S3ClientFactory } from '../src/main/infra/s3/client-factory'
import { S3ObjectStorage } from '../src/main/infra/s3/s3-object-storage'
import { startFakeS3, type FakeS3 } from './fake-s3'

/**
 * Sync decides what to upload and, when asked, what to delete. Getting either wrong
 * loses work, so the plan is tested directly rather than only through the UI.
 */

let server: FakeS3
let storage: S3ObjectStorage
let sync: SyncService
let work: string

const connection = (server: FakeS3): Connection => ({
  id: 'test',
  name: 'Fake S3',
  region: 'eu-west-1',
  endpoint: server.url,
  forcePathStyle: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  credentials: { kind: 'access-key', accessKeyId: 'test', secretAccessKey: 'secret' }
})

/** Records what would be queued, so a plan can be applied without real transfers. */
const queued: Array<{ key: string }> = []
const transfers = {
  uploadExact: async (
    _connectionId: string,
    _bucket: string,
    files: Array<{ key: string }>
  ) => {
    queued.push(...files)
    return files.length
  }
}

beforeEach(async () => {
  queued.length = 0
  server = await startFakeS3({
    buckets: ['sync-bucket'],
    objects: {
      // Same content and size as the local copy written below: unchanged.
      'sync-bucket/site/index.html': 'hello',
      // Different size from its local copy: changed.
      'sync-bucket/site/app.js': 'old',
      // No local counterpart: only deleted when asked for.
      'sync-bucket/site/stale.txt': 'gone tomorrow'
    }
  })

  const resolver = createCredentialResolver()
  storage = new S3ObjectStorage(new S3ClientFactory(resolver), resolver)
  sync = new SyncService(
    { get: async () => connection(server) } as never,
    storage,
    transfers as never
  )

  work = await mkdtemp(join(tmpdir(), 'bucketeer-sync-'))
  await mkdir(join(work, 'assets'), { recursive: true })
  await writeFile(join(work, 'index.html'), 'hello')
  await writeFile(join(work, 'app.js'), 'a much longer body than before')
  await writeFile(join(work, 'notes.md'), 'brand new')
  await writeFile(join(work, 'assets', 'logo.svg'), '<svg/>')
  await writeFile(join(work, 'scratch.tmp'), 'ignore me')
})

afterEach(async () => {
  storage.dispose()
  await server.close()
  await rm(work, { recursive: true, force: true })
})

const base = {
  connectionId: 'test',
  bucket: 'sync-bucket',
  prefix: 'site/',
  deleteRemote: false
}

describe('analyze', () => {
  it('uploads what is new and what changed, and leaves the rest alone', async () => {
    const plan = await sync.analyze({ ...base, localPath: work })

    const keys = plan.upload.map((item) => `${item.reason}:${item.key}`).sort()
    expect(keys).toEqual([
      'changed:site/app.js',
      'new:site/assets/logo.svg',
      'new:site/notes.md',
      'new:site/scratch.tmp'
    ])
    // Identical size and contents: not re-uploaded.
    expect(plan.unchanged).toBe(1)
  })

  it('treats a file with the same size but different contents as changed', async () => {
    // Same length as the stored object, so only a hash can tell them apart.
    await writeFile(join(work, 'index.html'), 'HELLO')

    const plan = await sync.analyze({ ...base, localPath: work })
    expect(plan.upload.some((item) => item.key === 'site/index.html')).toBe(true)
  })

  it('leaves an untouched file alone even when its timestamp moves', async () => {
    const future = new Date(Date.now() + 60_000)
    await utimes(join(work, 'index.html'), future, future)

    const plan = await sync.analyze({ ...base, localPath: work })
    // Contents are identical, so the hash settles it regardless of the clock.
    expect(plan.upload.some((item) => item.key === 'site/index.html')).toBe(false)
  })

  it('applies exclude rules and counts what they removed', async () => {
    const plan = await sync.analyze({ ...base, localPath: work, exclude: ['*.tmp'] })

    expect(plan.upload.some((item) => item.key.endsWith('.tmp'))).toBe(false)
    expect(plan.filtered).toBe(1)
  })

  it('considers only included files when an include rule is given', async () => {
    const plan = await sync.analyze({ ...base, localPath: work, include: ['**/*.svg'] })

    expect(plan.upload.map((item) => item.key)).toEqual(['site/assets/logo.svg'])
  })

  it('plans no deletions unless asked', async () => {
    const plan = await sync.analyze({ ...base, localPath: work })
    expect(plan.deleteRemote).toEqual([])
  })

  it('plans to delete remote objects with no local counterpart when mirroring', async () => {
    const plan = await sync.analyze({ ...base, localPath: work, deleteRemote: true })

    expect(plan.deleteRemote.map((item) => item.key)).toEqual(['site/stale.txt'])
  })

  it('never deletes something the filters excluded from the sync', async () => {
    // stale.txt is outside the include rule, so it is not the sync's business to remove.
    const plan = await sync.analyze({
      ...base,
      localPath: work,
      deleteRemote: true,
      include: ['**/*.svg']
    })

    expect(plan.deleteRemote).toEqual([])
  })
})

describe('apply', () => {
  it('queues exactly the planned uploads and deletes the planned objects', async () => {
    const request = { ...base, localPath: work, deleteRemote: true }
    const plan = await sync.analyze(request)

    const result = await sync.apply(request, plan)

    expect(result.queued).toBe(plan.upload.length)
    expect(queued.map((file) => file.key).sort()).toEqual(plan.upload.map((i) => i.key).sort())
    expect(result.deleted).toBe(1)
    expect(server.objects.has('sync-bucket/site/stale.txt')).toBe(false)
  })
})

describe('glob patterns', () => {
  const matches = (pattern: string, path: string) =>
    compileFilters({ include: [pattern] })(path)

  it('matches a bare name at any depth', () => {
    expect(matches('*.tmp', 'scratch.tmp')).toBe(true)
    expect(matches('*.tmp', 'deep/nested/scratch.tmp')).toBe(true)
  })

  it('keeps * from crossing a slash', () => {
    expect(matches('assets/*.svg', 'assets/logo.svg')).toBe(true)
    expect(matches('assets/*.svg', 'assets/icons/logo.svg')).toBe(false)
  })

  it('lets ** cross slashes, including none at all', () => {
    expect(matches('**/*.svg', 'logo.svg')).toBe(true)
    expect(matches('**/*.svg', 'assets/icons/logo.svg')).toBe(true)
  })

  it('covers a whole directory with a trailing slash', () => {
    expect(matches('node_modules/', 'node_modules/pkg/index.js')).toBe(true)
    expect(matches('node_modules/', 'src/index.js')).toBe(false)
  })

  it('understands alternatives', () => {
    expect(matches('*.{jpg,png}', 'photo.png')).toBe(true)
    expect(matches('*.{jpg,png}', 'photo.gif')).toBe(false)
  })

  it('excludes win over includes', () => {
    const allowed = compileFilters({ include: ['**/*.js'], exclude: ['**/vendor/'] })
    expect(allowed('src/app.js')).toBe(true)
    expect(allowed('vendor/lib.js')).toBe(false)
  })
})
