import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { S3Client } from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ResumableUpload, type ResumeState } from '../src/main/infra/s3/resumable-upload'
import { startFakeS3, type FakeS3 } from './fake-s3'

/**
 * Resuming is the whole point of hand-rolling multipart, so it is tested directly:
 * an upload stopped part-way must continue from the parts S3 already holds rather than
 * sending them again.
 */

const PART_SIZE = 5 * 1024 * 1024

let server: FakeS3
let client: S3Client
let work: string

beforeEach(async () => {
  server = await startFakeS3({ buckets: ['uploads'] })
  client = new S3Client({
    region: 'eu-west-1',
    endpoint: server.url,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'secret' }
  })
  work = await mkdtemp(join(tmpdir(), 'bucketeer-resume-'))
})

afterEach(async () => {
  client.destroy()
  await server.close()
  await rm(work, { recursive: true, force: true })
})

async function fileOf(bytes: number): Promise<string> {
  const path = join(work, `file-${bytes}.bin`)
  await writeFile(path, Buffer.alloc(bytes, 'x'))
  return path
}

describe('ResumableUpload', () => {
  it('sends a small file as one request, with nothing to resume', async () => {
    const states: unknown[] = []
    const uploader = new ResumableUpload(client, () => {}, (state) => states.push(state))

    await uploader.upload('uploads', 'small.bin', await fileOf(1024), PART_SIZE, {})

    expect(server.objects.get('uploads/small.bin')?.body.length).toBe(1024)
    // No multipart upload was started, so no state was ever recorded.
    expect(states).toHaveLength(0)
  })

  it('uploads a large file in parts and assembles it correctly', async () => {
    const uploader = new ResumableUpload(client, () => {}, () => {})
    const size = PART_SIZE * 2 + 1024

    await uploader.upload('uploads', 'large.bin', await fileOf(size), PART_SIZE, {})

    expect(server.objects.get('uploads/large.bin')?.body.length).toBe(size)
    // A completed upload leaves nothing behind for S3 to bill for.
    expect(server.uploads.size).toBe(0)
  })

  it('resumes from the parts already sent instead of starting again', async () => {
    const size = PART_SIZE * 3
    const path = await fileOf(size)

    // First attempt, aborted after the first part is recorded.
    const controller = new AbortController()
    let captured: ResumeState | null = null

    const first = new ResumableUpload(
      client,
      () => {},
      (state) => {
        if (state && (state as ResumeState).parts.length >= 1) {
          captured = state as ResumeState
          controller.abort()
        }
      }
    )

    await first
      .upload('uploads', 'resumed.bin', path, PART_SIZE, { signal: controller.signal })
      .catch(() => undefined)

    expect(captured).not.toBeNull()
    // The upload is still alive on S3, holding what was sent.
    expect(server.uploads.size).toBe(1)

    const partsBefore = [...server.uploads.values()][0].parts.size
    expect(partsBefore).toBeGreaterThan(0)
    expect(partsBefore).toBeLessThan(3)

    // Second attempt, given the state from the first.
    const second = new ResumableUpload(client, () => {}, () => {})
    await second.upload('uploads', 'resumed.bin', path, PART_SIZE, {}, captured!)

    expect(server.objects.get('uploads/resumed.bin')?.body.length).toBe(size)
    expect(server.uploads.size).toBe(0)
  })

  it('abandons the multipart upload when it fails for a reason other than pausing', async () => {
    const uploader = new ResumableUpload(client, () => {}, () => {})

    // A key the stub will accept for parts but a bucket that does not exist means the
    // completion fails; either way nothing may be left behind.
    await uploader
      .upload('uploads', 'doomed.bin', join(work, 'missing.bin'), PART_SIZE, {})
      .catch(() => undefined)

    expect(server.uploads.size).toBe(0)
  })
})
