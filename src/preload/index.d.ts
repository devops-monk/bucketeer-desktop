import type { BucketeerApi } from '@shared/ipc'

declare global {
  interface Window {
    bucketeer: BucketeerApi
    platform: NodeJS.Platform
  }
}

export {}
