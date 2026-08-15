import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Connection } from '@shared/types'
import { createCredentialResolver } from '../src/main/infra/credentials/resolver'
import { S3ClientFactory } from '../src/main/infra/s3/client-factory'
import { S3ObjectStorage } from '../src/main/infra/s3/s3-object-storage'
import { ResumableUpload, type ResumeState } from '../src/main/infra/s3/resumable-upload'

/**
 * The same adapter, against a real S3 implementation rather than our stub. The stub is
 * fast and runs everywhere, but it is our own reading of the protocol; this catches the
 * places where that reading is wrong.
 *
 * Skipped unless an endpoint is given, so CI stays Docker-free:
 *
 *   npm run test:minio
 *   S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_TEST_KEY=bucketeer S3_TEST_SECRET=bucketeer123 npm test
 *
 * MinIO is the default because it is free. LocalStack now needs a licence token, and its
 * last free image (3.8) rejects the trailer-based checksums the current AWS SDK sends,
 * so it fails these tests for reasons that have nothing to do with this code.
 */

const endpoint = process.env.S3_TEST_ENDPOINT
const bucket = process.env.S3_TEST_BUCKET ?? `bucketeer-test-${Date.now()}`

const connection: Connection = {
  id: 'live',
  name: 'Live endpoint',
  region: process.env.S3_TEST_REGION ?? 'us-east-1',
  endpoint,
  forcePathStyle: true,
  createdAt: new Date().toISOString(),
  credentials: {
    kind: 'access-key',
    accessKeyId: process.env.S3_TEST_KEY ?? 'test',
    secretAccessKey: process.env.S3_TEST_SECRET ?? 'test'
  }
}

/** Small enough to keep the suite quick, large enough to force three real parts. */
const PART_SIZE = 5 * 1024 * 1024

let storage: S3ObjectStorage
let client: S3Client
let work: string

describe.skipIf(!endpoint)('against a real S3 implementation', () => {
  beforeAll(async () => {
    client = new S3Client({
      region: connection.region,
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test', ...credentialOverride() }
    })
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
    } catch {
      // Already there from a previous run, which is fine.
    }
    const resolver = createCredentialResolver()
    storage = new S3ObjectStorage(new S3ClientFactory(resolver), resolver)
    work = await mkdtemp(join(tmpdir(), 'bucketeer-live-'))
  })

  afterAll(async () => {
    client?.destroy()
    storage?.dispose()
    if (work) await rm(work, { recursive: true, force: true })
  })

  it('round-trips a file through upload, listing and download', async () => {
    const source = join(work, 'roundtrip.txt')
    const destination = join(work, 'downloaded.txt')
    await writeFile(source, 'round trip contents')

    await storage.putObject(connection, bucket, 'live/roundtrip.txt', source, {})

    const listing = await storage.listObjects(connection, { bucket, prefix: 'live/' })
    expect(listing.objects.map((object) => object.name)).toContain('roundtrip.txt')

    await storage.getObject(connection, bucket, 'live/roundtrip.txt', destination, {})
    expect(await readFile(destination, 'utf8')).toBe('round trip contents')
  })

  it('reads only the first bytes when previewing', async () => {
    const source = join(work, 'preview.txt')
    // Longer than the range asked for, so a server ignoring Range would be caught.
    await writeFile(source, 'A'.repeat(5000))
    await storage.putObject(connection, bucket, 'live/preview.txt', source, {})

    const preview = await storage.getObjectRange(connection, bucket, 'live/preview.txt', 1000)

    expect(preview.data.length).toBe(1000)
    // The total comes from Content-Range, not from what arrived.
    expect(preview.size).toBe(5000)
    expect(preview.truncated).toBe(true)
  })

  it('signs a link a plain HTTP client can download', async () => {
    const url = await storage.presign(connection, bucket, 'live/roundtrip.txt', 300)
    const response = await fetch(url)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('round trip contents')
  })

  it('shows a created folder as a folder rather than an object', async () => {
    await storage.createFolder(connection, bucket, 'live/empty-folder/')

    const listing = await storage.listObjects(connection, { bucket, prefix: 'live/' })
    expect(listing.prefixes.map((prefix) => prefix.name)).toContain('empty-folder')
  })

  it('copies server-side and rewrites headers in place', async () => {
    await storage.copyObject(
      connection,
      { bucket, key: 'live/roundtrip.txt' },
      { bucket, key: 'live/copied.txt' }
    )

    await storage.replaceMetadata(connection, bucket, 'live/copied.txt', {
      contentType: 'text/markdown',
      cacheControl: 'max-age=60',
      metadata: { owner: 'bucketeer' }
    })

    const detail = await storage.headObject(connection, bucket, 'live/copied.txt')
    expect(detail.contentType).toBe('text/markdown')
    expect(detail.cacheControl).toBe('max-age=60')
    expect(detail.metadata?.owner).toBe('bucketeer')
    // The rewrite must not have damaged the contents it copied over.
    expect(detail.size).toBe('round trip contents'.length)
  })

  it('round-trips tags', async () => {
    await storage.putTags(connection, bucket, 'live/copied.txt', {
      team: 'platform',
      'cost-centre': '4021'
    })

    expect(await storage.getTags(connection, bucket, 'live/copied.txt')).toEqual({
      team: 'platform',
      'cost-centre': '4021'
    })
  })

  it('walks past a page boundary when listing everything under a prefix', async () => {
    const source = join(work, 'page.txt')
    await writeFile(source, 'page')
    await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        storage.putObject(connection, bucket, `live/paged/${index}.txt`, source, {})
      )
    )

    const keys = await storage.listAllKeys(connection, bucket, 'live/paged/')
    expect(keys).toHaveLength(12)
  })

  it('uploads a large file in real multipart parts', async () => {
    const path = join(work, 'large.bin')
    await writeFile(path, Buffer.alloc(PART_SIZE * 2 + 1024, 'x'))

    const uploader = new ResumableUpload(client, () => {}, () => {})
    await uploader.upload(bucket, 'live/large.bin', path, PART_SIZE, {})

    const detail = await storage.headObject(connection, bucket, 'live/large.bin')
    expect(detail.size).toBe(PART_SIZE * 2 + 1024)
  })

  it('resumes an interrupted multipart upload from the parts S3 already holds', async () => {
    const path = join(work, 'resumable.bin')
    const size = PART_SIZE * 3
    await writeFile(path, Buffer.alloc(size, 'y'))

    // Stop as soon as one part is confirmed, keeping the upload alive on the server.
    const controller = new AbortController()
    let captured: ResumeState | null = null
    const first = new ResumableUpload(
      client,
      () => {},
      (state) => {
        if (!captured && state && (state as ResumeState).parts.length >= 1) {
          captured = state as ResumeState
          controller.abort()
        }
      }
    )
    await first
      .upload(bucket, 'live/resumable.bin', path, PART_SIZE, { signal: controller.signal })
      .catch(() => undefined)

    expect(captured).not.toBeNull()

    // The second attempt adopts that upload id: ListParts on a real server is the check
    // that matters, because it is the answer we trust over our own record of what was sent.
    const second = new ResumableUpload(client, () => {}, () => {})
    await second.upload(bucket, 'live/resumable.bin', path, PART_SIZE, {}, captured!)

    const detail = await storage.headObject(connection, bucket, 'live/resumable.bin')
    expect(detail.size).toBe(size)
  })

  it('deletes what it uploaded', async () => {
    const keys = (await storage.listAllKeys(connection, bucket, 'live/')).map(
      (object) => object.key
    )
    const failures = await storage.deleteObjects(connection, bucket, keys)
    expect(failures).toEqual([])

    const listing = await storage.listObjects(connection, { bucket, prefix: 'live/' })
    expect(listing.objects).toHaveLength(0)
  })
})

function credentialOverride() {
  return process.env.S3_TEST_KEY
    ? { accessKeyId: process.env.S3_TEST_KEY, secretAccessKey: process.env.S3_TEST_SECRET ?? '' }
    : {}
}
