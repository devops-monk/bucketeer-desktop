import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
  type S3Client
} from '@aws-sdk/client-s3'
import type { UploadOptions } from '../../core/ports'

/**
 * CRC32C on every part and every whole-file upload. S3 verifies it and rejects a part
 * that does not match, which turns a silently corrupted transfer into a failed one.
 */
const CHECKSUM_ALGORITHM = 'CRC32C' as const

/** A part already uploaded, in the shape CompleteMultipartUpload wants back. */
export interface UploadedPart {
  partNumber: number
  etag: string
  size: number
}

/** Enough to pick an interrupted upload back up in a later run of the app. */
export interface ResumeState {
  uploadId: string
  bucket: string
  key: string
  localPath: string
  partSize: number
  parts: UploadedPart[]
}

/**
 * A multipart upload that can be paused and resumed, including across a restart.
 *
 * Written by hand rather than using lib-storage, which is otherwise the better tool: it
 * has no way to adopt an existing UploadId, so a cancelled upload can only start again
 * from zero. Here the UploadId and every completed part are handed to a callback as they
 * happen, so a 10 GB upload interrupted at 90% resumes at 90%.
 *
 * S3 keeps the parts of an incomplete upload and bills for them, which is why aborting
 * for real matters — and why a lifecycle rule cleaning up incomplete uploads is worth
 * having, something the bucket settings panel now shows.
 */
export class ResumableUpload {
  constructor(
    private readonly client: S3Client,
    private readonly onProgress: (transferred: number) => void,
    private readonly onState: (state: ResumeState | null) => void
  ) {}

  /**
   * Uploads a file, continuing from `resume` when one is given.
   *
   * Small files skip multipart entirely: a single PutObject is one request rather than
   * three, and there is nothing meaningful to resume anyway.
   */
  async upload(
    bucket: string,
    key: string,
    localPath: string,
    partSize: number,
    options: UploadOptions,
    resume?: ResumeState
  ): Promise<void> {
    const { size } = await stat(localPath)

    if (size <= partSize && !resume) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(localPath),
          ContentType: options.contentType,
          ChecksumAlgorithm: CHECKSUM_ALGORITHM,
          ...encryption(options),
          ...(options.storageClass ? { StorageClass: options.storageClass as never } : {})
        })
      )
      this.onProgress(size)
      return
    }

    const uploadId = resume?.uploadId ?? (await this.begin(bucket, key, options))
    // Parts S3 already holds win over what we remembered: the two disagree if the app
    // stopped between uploading a part and recording it.
    const parts = await this.reconcile(bucket, key, uploadId, resume?.parts ?? [])

    const state: ResumeState = { uploadId, bucket, key, localPath, partSize, parts }
    this.onState(state)

    try {
      let transferred = parts.reduce((sum, part) => sum + part.size, 0)
      const total = Math.ceil(size / partSize)

      for (let number = 1; number <= total; number += 1) {
        if (parts.some((part) => part.partNumber === number)) continue
        if (options.signal?.aborted) return

        const start = (number - 1) * partSize
        const end = Math.min(start + partSize, size) - 1

        const result = await this.client.send(
          new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: number,
            // A fresh stream per part, so a retry re-reads rather than resuming a
            // consumed one.
            Body: createReadStream(localPath, { start, end }),
            ContentLength: end - start + 1,
            ChecksumAlgorithm: CHECKSUM_ALGORITHM
          }),
          { abortSignal: options.signal }
        )

        parts.push({
          partNumber: number,
          etag: result.ETag ?? '',
          size: end - start + 1
        })
        transferred += end - start + 1

        this.onProgress(transferred)
        // Recorded after each part, so an interruption loses at most one part's work.
        this.onState({ ...state, parts })
      }

      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag }))
          }
        })
      )

      this.onState(null)
    } catch (error) {
      // A pause keeps the upload alive on S3 so it can be resumed. Any other failure
      // abandons it, because leaving parts behind quietly costs storage.
      if (!options.signal?.aborted) {
        await this.abort(bucket, key, uploadId)
        this.onState(null)
      }
      throw error
    }
  }

  /** Throws away an interrupted upload and the parts S3 is holding for it. */
  async abort(bucket: string, key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })
      )
    } catch {
      // Already gone, or never existed. Either way there is nothing to clean up.
    }
  }

  private async begin(bucket: string, key: string, options: UploadOptions): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: options.contentType,
        ...encryption(options),
        ...(options.storageClass ? { StorageClass: options.storageClass as never } : {})
      })
    )

    if (!result.UploadId) throw new Error('S3 did not return an upload id.')
    return result.UploadId
  }

  /**
   * Asks S3 which parts it actually holds.
   *
   * Trusting the local record alone risks re-uploading a part S3 already has, or worse,
   * completing an upload with a part number that was never sent.
   */
  private async reconcile(
    bucket: string,
    key: string,
    uploadId: string,
    remembered: UploadedPart[]
  ): Promise<UploadedPart[]> {
    try {
      const result = await this.client.send(
        new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId })
      )

      return (result.Parts ?? [])
        .filter((part) => part.PartNumber !== undefined && part.ETag)
        .map((part) => ({
          partNumber: part.PartNumber as number,
          etag: part.ETag as string,
          size: part.Size ?? 0
        }))
    } catch {
      // A brand new upload has nothing to list, and an expired one is better retried
      // from what we remember than abandoned.
      return remembered
    }
  }
}

function encryption(options: UploadOptions) {
  return options.kmsKeyId
    ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: options.kmsKeyId }
    : {}
}
