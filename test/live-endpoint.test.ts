import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Connection } from '@shared/types'
import { createCredentialResolver } from '../src/main/infra/credentials/resolver'
import { S3ClientFactory } from '../src/main/infra/s3/client-factory'
import { S3ObjectStorage } from '../src/main/infra/s3/s3-object-storage'

/**
 * The same adapter, against a real S3 implementation — LocalStack or MinIO — rather than
 * our stub. The stub is fast and runs everywhere, but it is our own reading of the
 * protocol; this catches the places where that reading is wrong.
 *
 * Skipped unless an endpoint is given, so CI stays Docker-free:
 *
 *   npm run test:localstack
 *   S3_TEST_ENDPOINT=http://127.0.0.1:4566 npm test
 *
 *   npm run test:minio
 *   S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_TEST_KEY=bucketeer S3_TEST_SECRET=bucketeer123 npm test
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

let storage: S3ObjectStorage
let work: string

describe.skipIf(!endpoint)('against a real S3 implementation', () => {
  beforeAll(async () => {
    const client = new S3Client({
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
    client.destroy()

    const resolver = createCredentialResolver()
    storage = new S3ObjectStorage(new S3ClientFactory(resolver), resolver)
    work = await mkdtemp(join(tmpdir(), 'bucketeer-live-'))
  })

  afterAll(async () => {
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

  it('deletes what it uploaded', async () => {
    const failures = await storage.deleteObjects(connection, bucket, ['live/roundtrip.txt'])
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
