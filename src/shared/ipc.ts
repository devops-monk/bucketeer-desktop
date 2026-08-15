import type {
  Bucket,
  Connection,
  ConnectionSummary,
  CreateFolderRequest,
  DeleteRequest,
  DeleteResult,
  DownloadRequest,
  ListObjectsRequest,
  ListingPage,
  ObjectDetail,
  PresignRequest,
  RenameRequest,
  Result,
  Transfer,
  UploadRequest
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
  objectHead: 'objects:head',
  objectsDelete: 'objects:delete',
  objectsRename: 'objects:rename',
  objectsCreateFolder: 'objects:create-folder',
  objectsPresign: 'objects:presign',
  transfersUpload: 'transfers:upload',
  transfersDownload: 'transfers:download',
  transfersList: 'transfers:list',
  transfersCancel: 'transfers:cancel',
  transfersClearFinished: 'transfers:clear-finished',
  /** Main → renderer: the transfer queue changed. */
  transfersChanged: 'transfers:changed',
  dialogPickFiles: 'dialog:pick-files',
  dialogPickDirectory: 'dialog:pick-directory'
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
    remove(request: DeleteRequest): Promise<Result<DeleteResult>>
    /** Server-side copy then delete — S3 has no rename. */
    rename(request: RenameRequest): Promise<Result<void>>
    createFolder(request: CreateFolderRequest): Promise<Result<void>>
    /** Time-limited URL anyone can use, no credentials required. */
    presign(request: PresignRequest): Promise<Result<string>>
  }
  transfers: {
    upload(request: UploadRequest): Promise<Result<number>>
    download(request: DownloadRequest): Promise<Result<number>>
    list(): Promise<Result<Transfer[]>>
    cancel(id: string): Promise<Result<void>>
    clearFinished(): Promise<Result<void>>
    /** Subscribes to queue changes. Returns an unsubscribe function. */
    onChanged(listener: (transfers: Transfer[]) => void): () => void
  }
  dialog: {
    /** Native file picker. Empty array means the user cancelled. */
    pickFiles(): Promise<Result<string[]>>
    pickDirectory(): Promise<Result<string | null>>
  }
}
