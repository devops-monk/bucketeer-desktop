import type { BucketEncryption, UploadEncryption } from '@shared/types'
import { api } from './api'

export interface ResolvedEncryption {
  encryption: UploadEncryption
  /** True when we could not work out a key and the user has to decide. */
  needsChoice: boolean
  /** What the key resolution found, for display. */
  bucket: BucketEncryption | null
}

/**
 * Works out how an upload should be encrypted, asking the user only when it genuinely
 * cannot be determined.
 *
 * Requiring a key ARN from someone uploading a spreadsheet is a bad trade: the value is
 * almost always discoverable, either from the connection, the bucket's default
 * encryption, or an object already sitting in the bucket. A prompt is a last resort,
 * not a checkpoint.
 */
export async function resolveUploadEncryption(
  connectionId: string,
  bucket: string,
  override: UploadEncryption | null,
  connectionKey: string | undefined
): Promise<ResolvedEncryption> {
  // An explicit choice always wins and is never second-guessed.
  if (override) return { encryption: override, needsChoice: false, bucket: null }

  if (connectionKey) {
    return { encryption: { mode: 'auto' }, needsChoice: false, bucket: null }
  }

  let found: BucketEncryption | null = null
  try {
    found = await api.buckets.encryption(connectionId, bucket)
  } catch {
    // Treated as "unknown", which the caller turns into a prompt.
  }

  // mode:auto re-resolves the same value in the main process rather than sending the
  // key back down, so the upload uses what the bucket says at the moment it runs.
  if (found?.kmsKeyId) return { encryption: { mode: 'auto' }, needsChoice: false, bucket: found }

  return { encryption: { mode: 'auto' }, needsChoice: true, bucket: found }
}

/** Shortens a key ARN to something that fits in a toolbar. */
export function shortKeyLabel(keyId: string): string {
  if (keyId.startsWith('alias/')) return keyId
  const id = keyId.split('/').pop() ?? keyId
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}
