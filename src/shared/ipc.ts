import type {
  Bucket,
  BucketEncryption,
  BucketSettings,
  CopyResult,
  CorsRule,
  CreateBucketRequest,
  DeleteBucketRequest,
  SetStorageClassRequest,
  TransferObjectsRequest,
  VersionActionRequest,
  Connection,
  ConnectionSummary,
  CreateFolderRequest,
  DeleteRequest,
  DeleteResult,
  DownloadRequest,
  ListObjectsRequest,
  ListingPage,
  ObjectDetail,
  ObjectHeaders,
  ObjectVersion,
  Preferences,
  PresignRequest,
  RestoreRequest,
  RenameRequest,
  KmsKey,
  Result,
  SsoLoginResult,
  SsoPending,
  SyncPlan,
  SyncRequest,
  ThemePreference,
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
  credentialsSsoLogin: 'credentials:sso-login',
  credentialsKmsKeys: 'credentials:kms-keys',
  /** Main → renderer: a login is waiting for browser approval. */
  ssoPending: 'credentials:sso-pending',
  bucketsList: 'buckets:list',
  objectsList: 'objects:list',
  objectHead: 'objects:head',
  objectsDelete: 'objects:delete',
  objectsRename: 'objects:rename',
  objectsCreateFolder: 'objects:create-folder',
  objectsPresign: 'objects:presign',
  objectsVersions: 'objects:versions',
  objectsRestoreVersion: 'objects:restore-version',
  objectsDeleteVersion: 'objects:delete-version',
  objectsGetTags: 'objects:get-tags',
  objectsSetTags: 'objects:set-tags',
  objectsSetHeaders: 'objects:set-headers',
  objectsRestore: 'objects:restore',
  bucketsEncryption: 'buckets:encryption',
  bucketsSettings: 'buckets:settings',
  bucketsSetPolicy: 'buckets:set-policy',
  bucketsSetVersioning: 'buckets:set-versioning',
  bucketsSetCors: 'buckets:set-cors',
  bucketsCreate: 'buckets:create',
  bucketsDelete: 'buckets:delete',
  objectsCopy: 'objects:copy',
  objectsStorageClass: 'objects:storage-class',
  syncAnalyze: 'sync:analyze',
  syncApply: 'sync:apply',
  transfersUpload: 'transfers:upload',
  transfersDownload: 'transfers:download',
  transfersList: 'transfers:list',
  transfersCancel: 'transfers:cancel',
  transfersClearFinished: 'transfers:clear-finished',
  /** Main → renderer: the transfer queue changed. */
  transfersChanged: 'transfers:changed',
  appVersion: 'app:version',
  appGetPreferences: 'app:get-preferences',
  appSetPreferences: 'app:set-preferences',
  appGetTheme: 'app:get-theme',
  appSetTheme: 'app:set-theme',
  appRevealFile: 'app:reveal-file',
  appDownloadsFolder: 'app:downloads-folder',
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
    /**
     * Signs a profile in to IAM Identity Center by opening the browser. Resolves once
     * the user has approved, or rejects on timeout.
     */
    ssoLogin(profileName: string): Promise<Result<SsoLoginResult>>
    /** Fires while a login waits for approval, carrying the code to display. */
    onSsoPending(listener: (pending: SsoPending) => void): () => void
    /** KMS keys this connection can list. Empty when the call is denied. */
    kmsKeys(connectionId: string): Promise<Result<KmsKey[]>>
  }
  buckets: {
    list(connectionId: string): Promise<Result<Bucket[]>>
    /** The bucket's default encryption, or null when unset or not readable. */
    encryption(connectionId: string, bucket: string): Promise<Result<BucketEncryption | null>>
    /** Policy, versioning, public access and encryption, each denied independently. */
    settings(connectionId: string, bucket: string): Promise<Result<BucketSettings>>
    /** Replaces the policy, or removes it when given null. Validated before sending. */
    setPolicy(connectionId: string, bucket: string, policy: string | null): Promise<Result<void>>
    setVersioning(connectionId: string, bucket: string, enabled: boolean): Promise<Result<void>>
    /** Replaces the CORS rules, or removes them when given null. */
    setCors(connectionId: string, bucket: string, rules: CorsRule[] | null): Promise<Result<void>>
    create(request: CreateBucketRequest): Promise<Result<void>>
    /** Fails while the bucket still holds anything, which S3 enforces. */
    remove(request: DeleteBucketRequest): Promise<Result<void>>
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
    /** Server-side copy or move, within a bucket or across buckets. */
    copy(request: TransferObjectsRequest): Promise<Result<CopyResult>>
    setStorageClass(request: SetStorageClassRequest): Promise<Result<CopyResult>>
    /** Every stored version of one object, newest first, including delete markers. */
    versions(connectionId: string, bucket: string, key: string): Promise<Result<ObjectVersion[]>>
    /** Copies an old version over the current one. The replaced version is kept. */
    restoreVersion(request: VersionActionRequest): Promise<Result<void>>
    /** Removes one version permanently. This cannot be undone. */
    deleteVersion(request: VersionActionRequest): Promise<Result<void>>
    tags(connectionId: string, bucket: string, key: string): Promise<Result<Record<string, string>>>
    /** Replaces the whole tag set; S3 has no partial update. */
    setTags(
      connectionId: string,
      bucket: string,
      key: string,
      tags: Record<string, string>
    ): Promise<Result<void>>
    /** Rewrites HTTP headers and user metadata in place. */
    setHeaders(
      connectionId: string,
      bucket: string,
      key: string,
      headers: ObjectHeaders
    ): Promise<Result<void>>
    /** Starts a Glacier restore. Completion is read from the object's restore status. */
    restore(
      request: RestoreRequest
    ): Promise<Result<{ started: number; failed: Array<{ key: string; reason: string }> }>>
  }
  sync: {
    /** Works out what would change, without changing anything. */
    analyze(request: SyncRequest): Promise<Result<SyncPlan>>
    apply(request: SyncRequest, plan: SyncPlan): Promise<Result<{ queued: number; deleted: number }>>
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
  app: {
    version(): Promise<Result<string>>
    getPreferences(): Promise<Result<Preferences>>
    /** Saved and applied immediately; transfers already running keep their settings. */
    setPreferences(preferences: Preferences): Promise<Result<void>>
    getTheme(): Promise<Result<ThemePreference>>
    setTheme(theme: ThemePreference): Promise<Result<void>>
    /** The OS Downloads folder, used when a download is not given a destination. */
    downloadsFolder(): Promise<Result<string>>
    /** Shows a finished transfer in Finder or Explorer. */
    revealFile(path: string): Promise<Result<void>>
  }
  dialog: {
    /** Native file picker. Empty array means the user cancelled. */
    pickFiles(): Promise<Result<string[]>>
    pickDirectory(): Promise<Result<string | null>>
  }
}
