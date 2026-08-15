import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Connection } from '@shared/types'
import { ObjectService } from '../src/main/app/object-service'
import { createCredentialResolver } from '../src/main/infra/credentials/resolver'
import { S3ClientFactory } from '../src/main/infra/s3/client-factory'
import { S3ObjectStorage } from '../src/main/infra/s3/s3-object-storage'
import { startFakeS3, type FakeS3 } from './fake-s3'

/**
 * These exercise the real adapter against a real HTTP server speaking S3's protocol.
 * Nothing below the service layer is mocked, so a wrong parameter name or a mishandled
 * response fails here rather than in someone's bucket.
 */

const KMS_KEY = 'arn:aws:kms:eu-west-1:123456789012:key/1b471aa9-76a9-43bb-8c2b-c979ef3f5e5a'

let server: FakeS3
let storage: S3ObjectStorage
let objects: ObjectService
let work: string

function connectionFor(server: FakeS3): Connection {
  return {
    id: 'test',
    name: 'Fake S3',
    region: 'eu-west-1',
    endpoint: server.url,
    forcePathStyle: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    credentials: { kind: 'access-key', accessKeyId: 'test', secretAccessKey: 'secret' }
  }
}

/** A repository standing in for the encrypted store, which needs Electron. */
function repositoryFor(connection: Connection) {
  return {
    list: async () => [connection],
    get: async () => connection,
    save: async (value: Connection) => value,
    remove: async () => {},
    canStoreSecrets: () => true
  }
}

beforeEach(async () => {
  server = await startFakeS3({
    buckets: ['test-bucket', 'plain-bucket'],
    objects: {
      'test-bucket/reports/2026/q1.csv': 'quarter one',
      'test-bucket/reports/2026/q2.csv': 'quarter two',
      'test-bucket/reports/readme.txt': 'read me',
      'test-bucket/other/notes.txt': 'notes',
      'plain-bucket/notes.txt': 'plain'
    },
    encryption: {
      'test-bucket': { algorithm: 'aws:kms', kmsKeyId: KMS_KEY },
      'plain-bucket': { algorithm: 'AES256' }
    },
    // Mirrors a real bucket policy: readable objects, but no encryption configuration.
    encryptionDenied: ['test-bucket']
  })

  const resolver = createCredentialResolver()
  storage = new S3ObjectStorage(new S3ClientFactory(resolver), resolver)
  objects = new ObjectService(repositoryFor(connectionFor(server)) as never, storage)
  work = await mkdtemp(join(tmpdir(), 'bucketeer-test-'))
})

afterEach(async () => {
  storage.dispose()
  await server.close()
  await rm(work, { recursive: true, force: true })
})

describe('listing', () => {
  it('returns folders as prefixes rather than keys', async () => {
    const page = await storage.listObjects(connectionFor(server), {
      bucket: 'test-bucket',
      prefix: 'reports/'
    })

    expect(page.prefixes.map((prefix) => prefix.name)).toEqual(['2026'])
    expect(page.objects.map((object) => object.name)).toEqual(['readme.txt'])
  })

  it('walks every key when recursive', async () => {
    const all = await storage.listAllKeys(connectionFor(server), 'test-bucket', 'reports/')
    expect(all.map((object) => object.key).sort()).toEqual([
      'reports/2026/q1.csv',
      'reports/2026/q2.csv',
      'reports/readme.txt'
    ])
  })
})

describe('transfers', () => {
  it('uploads a file and sends the KMS headers when given a key', async () => {
    const local = join(work, 'upload.txt')
    await writeFile(local, 'hello')

    await storage.putObject(connectionFor(server), 'test-bucket', 'new/upload.txt', local, {
      kmsKeyId: KMS_KEY
    })

    expect(server.objects.get('test-bucket/new/upload.txt')?.body.toString()).toBe('hello')

    const put = server.requests.filter((request) => request.method === 'PUT').at(-1)
    expect(put?.headers['x-amz-server-side-encryption']).toBe('aws:kms')
    expect(put?.headers['x-amz-server-side-encryption-aws-kms-key-id']).toBe(KMS_KEY)
  })

  it('sends no encryption headers when no key applies', async () => {
    const local = join(work, 'plain.txt')
    await writeFile(local, 'plain')

    await storage.putObject(connectionFor(server), 'plain-bucket', 'plain.txt', local, {})

    const put = server.requests.filter((request) => request.method === 'PUT').at(-1)
    expect(put?.headers['x-amz-server-side-encryption']).toBeUndefined()
  })

  it('downloads to disk, creating parent directories', async () => {
    const local = join(work, 'nested', 'deeper', 'q1.csv')
    await storage.getObject(connectionFor(server), 'test-bucket', 'reports/2026/q1.csv', local, {})

    expect(await readFile(local, 'utf8')).toBe('quarter one')
  })

  it('reports progress as bytes arrive', async () => {
    const seen: number[] = []
    const local = join(work, 'progress.csv')

    await storage.getObject(connectionFor(server), 'test-bucket', 'reports/2026/q1.csv', local, {
      onProgress: (transferred) => seen.push(transferred)
    })

    expect(seen.at(-1)).toBe('quarter one'.length)
  })
})

describe('encryption resolution', () => {
  it('infers the key from an existing object when the bucket will not say', async () => {
    // GetBucketEncryption is denied for this bucket, exactly as a real policy does.
    const resolved = await storage.getDefaultEncryption(connectionFor(server), 'test-bucket')

    expect(resolved).toEqual({ sseAlgorithm: 'aws:kms', kmsKeyId: KMS_KEY })
  })

  it('resolves an ordinary bucket to SSE-S3 with no key', async () => {
    const resolved = await storage.getDefaultEncryption(connectionFor(server), 'plain-bucket')

    expect(resolved?.sseAlgorithm).toBe('AES256')
    expect(resolved?.kmsKeyId).toBeUndefined()
  })
})

describe('mutations', () => {
  it('renames by copying then deleting the original', async () => {
    await objects.rename({
      connectionId: 'test',
      bucket: 'test-bucket',
      sourceKey: 'reports/readme.txt',
      targetKey: 'reports/readme-renamed.txt'
    })

    expect(server.objects.has('test-bucket/reports/readme-renamed.txt')).toBe(true)
    expect(server.objects.has('test-bucket/reports/readme.txt')).toBe(false)
  })

  it('deletes a prefix and everything beneath it', async () => {
    const result = await objects.remove({
      connectionId: 'test',
      bucket: 'test-bucket',
      keys: [],
      prefixes: ['reports/2026/']
    })

    expect(result.deleted).toBeGreaterThanOrEqual(2)
    expect(server.objects.has('test-bucket/reports/2026/q1.csv')).toBe(false)
    // Deleting one folder must not touch its siblings.
    expect(server.objects.has('test-bucket/reports/readme.txt')).toBe(true)
  })

  it('creates a folder as a marker object ending in a slash', async () => {
    await objects.createFolder({
      connectionId: 'test',
      bucket: 'test-bucket',
      prefix: 'reports/',
      name: 'empty'
    })

    expect(server.objects.has('test-bucket/reports/empty/')).toBe(true)
  })

  it('refuses a folder name containing a slash', async () => {
    await expect(
      objects.createFolder({
        connectionId: 'test',
        bucket: 'test-bucket',
        prefix: '',
        name: 'a/b'
      })
    ).rejects.toThrow(/cannot contain/i)
  })

  it('signs a time-limited share link', async () => {
    const url = await objects.presign({
      connectionId: 'test',
      bucket: 'test-bucket',
      key: 'reports/readme.txt',
      expiresInSeconds: 3600
    })

    expect(url).toContain('X-Amz-Signature')
    expect(url).toContain('X-Amz-Expires=3600')
  })

  it('refuses a link lasting longer than SigV4 allows', async () => {
    await expect(
      objects.presign({
        connectionId: 'test',
        bucket: 'test-bucket',
        key: 'reports/readme.txt',
        expiresInSeconds: 8 * 24 * 60 * 60
      })
    ).rejects.toThrow(/seven days/i)
  })
})

describe('paths', () => {
  it('round-trips a key containing spaces and symbols', async () => {
    const local = join(work, 'odd.txt')
    await writeFile(local, 'odd contents')
    const key = 'reports/2023-06-30 13.28.48Z FILENAME_R13 (final).csv'

    await storage.putObject(connectionFor(server), 'test-bucket', key, local, {})
    await objects.rename({
      connectionId: 'test',
      bucket: 'test-bucket',
      sourceKey: key,
      targetKey: 'reports/renamed with spaces.csv'
    })

    expect(server.objects.has('test-bucket/reports/renamed with spaces.csv')).toBe(true)
  })
})

describe('directories', () => {
  it('creates the destination tree when downloading a nested key', async () => {
    await mkdir(join(work, 'out'), { recursive: true })
    const local = join(work, 'out', 'a', 'b', 'c.csv')

    await storage.getObject(connectionFor(server), 'test-bucket', 'reports/2026/q2.csv', local, {})

    expect(await readFile(local, 'utf8')).toBe('quarter two')
  })
})
