import type { BucketeerApi } from '@shared/ipc'

declare global {
  interface Window {
    bucketeer: BucketeerApi
    platform: NodeJS.Platform
    /** Resolves a dropped File to its absolute path. Empty string if unavailable. */
    pathForFile: (file: File) => string
  }
}

export {}
