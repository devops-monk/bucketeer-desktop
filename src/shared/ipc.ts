import type {
  Bucket,
  Connection,
  ConnectionSummary,
  ListObjectsRequest,
  ListingPage,
  ObjectDetail,
  Result
} from './types'

/** IPC channel names. Keep them namespaced so the preload allowlist stays readable. */
export const Channels = {
  connectionsList: 'connections:list',
  connectionsSave: 'connections:save',
  connectionsRemove: 'connections:remove',
  connectionsTest: 'connections:test',
  connectionsSecretsAvailable: 'connections:secrets-available',
  sharedProfilesList: 'credentials:shared-profiles',
  bucketsList: 'buckets:list',
  objectsList: 'objects:list',
  objectHead: 'objects:head'
} as const

/**
 * The complete API exposed to the renderer through the preload bridge.
 * Every method resolves to a Result — the renderer never sees a thrown AWS error.
 */
export interface BucketeerApi {
  connections: {
    list(): Promise<Result<ConnectionSummary[]>>
    /** Omit `id` to create; include it to update in place. */
    save(connection: Omit<Connection, 'id' | 'createdAt'> & { id?: string }): Promise<Result<ConnectionSummary>>
    remove(id: string): Promise<Result<void>>
    /** Resolves credentials and calls ListBuckets. Returns the caller's account id when known. */
    test(id: string): Promise<Result<{ accountId?: string; buckets: number }>>
    /** False when the OS keychain is unavailable, meaning secrets cannot be persisted. */
    secretsAvailable(): Promise<Result<boolean>>
  }
  credentials: {
    /** Profile names found in ~/.aws/config and ~/.aws/credentials. */
    sharedProfiles(): Promise<Result<string[]>>
  }
  buckets: {
    list(connectionId: string): Promise<Result<Bucket[]>>
  }
  objects: {
    list(request: ListObjectsRequest): Promise<Result<ListingPage>>
    head(connectionId: string, bucket: string, key: string): Promise<Result<ObjectDetail>>
  }
}
