import type { CommonPrefix, _Object } from '@aws-sdk/client-s3'
import type { S3Object, S3Prefix } from '@shared/types'

/**
 * Translation between the SDK's wire shapes and our domain types. Kept apart from the
 * storage adapter so the mapping rules — which carry most of S3's quirks — can be read
 * and tested on their own.
 */

/** ETags come back quoted; nobody wants to see the quotes. */
export function cleanETag(etag: string | undefined): string | undefined {
  return etag?.replace(/"/g, '')
}

export function toPrefix(common: CommonPrefix, parent: string): S3Prefix | null {
  if (!common.Prefix) return null
  return {
    prefix: common.Prefix,
    name: common.Prefix.slice(parent.length).replace(/\/$/, '')
  }
}

export function toObject(entry: _Object, parent: string, recursive: boolean): S3Object | null {
  if (!entry.Key) return null
  return {
    key: entry.Key,
    // A flat listing shows the path below the prefix; a browsed one shows just the leaf.
    name: recursive ? entry.Key.slice(parent.length) : (entry.Key.split('/').pop() ?? entry.Key),
    size: entry.Size ?? 0,
    lastModified: entry.LastModified?.toISOString(),
    etag: cleanETag(entry.ETag),
    storageClass: entry.StorageClass
  }
}

/**
 * S3 has no directories. The console fakes them with zero-byte objects whose key is the
 * prefix itself, and those must not appear as files inside the folder they represent.
 */
export function isFolderMarker(entry: _Object, parent: string): boolean {
  return entry.Key === parent || (entry.Key?.endsWith('/') === true && (entry.Size ?? 0) === 0)
}
