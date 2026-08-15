import type { BucketEncryption, UploadEncryption } from '@shared/types'
import { api } from './api'

/**
 * Works out how an upload should be encrypted.
 *
 * The rule is that uploading never stops to ask. Most buckets need no key at all —
 * since 2023 every bucket encrypts by default, and for ordinary buckets that default is
 * SSE-S3, which requires no headers from us. Buckets that mandate a specific KMS key are
 * the exception, and their key is discoverable from the connection, the bucket's default
 * encryption, or an object already inside it.
 *
 * If all of that fails, the upload is still attempted rather than blocked: the failure
 * message names what was sent, and the toolbar badge sets a key for the retry. Making
 * everyone answer an encryption question to protect the rare case would be the wrong
 * trade.
 */
export async function resolveUploadEncryption(
  override: UploadEncryption | null
): Promise<UploadEncryption> {
  // An explicit choice always wins and is never second-guessed.
  return override ?? { mode: 'auto' }
}

/** What the current bucket encrypts with, for display. Null when it will not say. */
export async function readBucketEncryption(
  connectionId: string,
  bucket: string
): Promise<BucketEncryption | null> {
  try {
    return await api.buckets.encryption(connectionId, bucket)
  } catch {
    return null
  }
}

/** Shortens a key ARN to something that fits in a toolbar. */
export function shortKeyLabel(keyId: string): string {
  if (keyId.startsWith('alias/')) return keyId
  const id = keyId.split('/').pop() ?? keyId
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

/** How to describe a bucket's encryption in one short phrase. */
export function describeEncryption(
  override: UploadEncryption | null,
  connectionKey: string | undefined,
  bucket: BucketEncryption | null
): { label: string; tone: 'good' | 'plain' | 'warn'; detail: string } {
  if (override?.mode === 'none') {
    return {
      label: 'no encryption',
      tone: 'warn',
      detail: 'Uploads will be sent without encryption headers.'
    }
  }
  if (override?.mode === 'kms') {
    return {
      label: shortKeyLabel(override.kmsKeyId),
      tone: 'good',
      detail: `Uploads will be encrypted with ${override.kmsKeyId}.`
    }
  }
  if (connectionKey) {
    return {
      label: shortKeyLabel(connectionKey),
      tone: 'good',
      detail: `Uploads will be encrypted with ${connectionKey}, set on this connection.`
    }
  }
  if (bucket?.kmsKeyId) {
    return {
      label: shortKeyLabel(bucket.kmsKeyId),
      tone: 'good',
      detail: `Uploads will be encrypted with ${bucket.kmsKeyId}, which this bucket uses.`
    }
  }
  if (bucket) {
    // SSE-S3 and the like need nothing from the client; S3 applies them itself.
    return {
      label: bucket.sseAlgorithm === 'AES256' ? 'bucket default' : bucket.sseAlgorithm,
      tone: 'plain',
      detail: `This bucket encrypts new objects with ${bucket.sseAlgorithm} on its own, so uploads need no key.`
    }
  }
  return {
    label: 'bucket default',
    tone: 'plain',
    detail:
      'This bucket did not say how it encrypts new objects, so uploads are sent without encryption headers and the bucket applies its own default. If the bucket requires a specific KMS key, set one here.'
  }
}
