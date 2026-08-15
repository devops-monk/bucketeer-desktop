/**
 * Types shared by the main and renderer processes.
 *
 * Anything defined here can cross the IPC boundary, so it must be structured-clonable:
 * plain data only, no class instances, no functions, no Dates.
 */

/** How Bucketeer obtains AWS credentials for a connection. */
export type CredentialSource =
  | { kind: 'access-key'; accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  | { kind: 'shared-profile'; profileName: string }
  | { kind: 'environment' }
  | { kind: 'default-chain' }
  | {
      kind: 'assume-role'
      roleArn: string
      /** Credentials used to call sts:AssumeRole. Cannot itself be an assume-role. */
      base: BaseCredentialSource
      sessionName?: string
      externalId?: string
      /** ARN or serial number of the MFA device, if the role's trust policy requires MFA. */
      mfaSerial?: string
      durationSeconds?: number
    }

export type BaseCredentialSource = Exclude<CredentialSource, { kind: 'assume-role' }>

export type CredentialKind = CredentialSource['kind']

/** A saved connection to S3 or an S3-compatible endpoint. */
export interface Connection {
  id: string
  name: string
  region: string
  credentials: CredentialSource
  /** Custom endpoint for S3-compatible storage (MinIO, R2, Wasabi, Backblaze). */
  endpoint?: string
  /** Path-style addressing — required by most non-AWS endpoints. */
  forcePathStyle?: boolean
  /** Default KMS key for uploads on this connection. Overridable per transfer. */
  kmsKeyId?: string
  /** Routes transfers through S3 Transfer Acceleration, when the bucket allows it. */
  transferAcceleration?: boolean
  createdAt: string
}

/**
 * The non-secret parts of a credential source.
 *
 * Sent to the renderer so the connection editor can show what was actually saved.
 * Everything here is safe to display; secrets are never included, which is why editing
 * a key-based connection has to ask for the key again.
 */
export interface CredentialFacts {
  kind: CredentialKind
  /** Human-readable summary, e.g. "Profile non-prd-fs". */
  label: string
  profileName?: string
  roleArn?: string
  sessionName?: string
  externalId?: string
  mfaSerial?: string
  /** For assume-role: which profile is used to call sts:AssumeRole. */
  baseProfileName?: string
}

/** A connection minus its secrets, safe to hold in the renderer. */
export type ConnectionSummary = Omit<Connection, 'credentials'> & {
  credentials: CredentialFacts
}

export interface Bucket {
  name: string
  createdAt?: string
  /** Resolved lazily; undefined until we've asked S3 where the bucket lives. */
  region?: string
}

export interface S3Object {
  key: string
  /** Key with the listed prefix stripped — what the file list shows. */
  name: string
  size: number
  lastModified?: string
  etag?: string
  storageClass?: string
}

export interface S3Prefix {
  /** Full prefix including the trailing delimiter, e.g. "logs/2026/". */
  prefix: string
  /** Just this level's segment, e.g. "2026". */
  name: string
}

export interface ListingPage {
  prefixes: S3Prefix[]
  objects: S3Object[]
  /** Continuation token for the next page, or null when the listing is exhausted. */
  nextToken: string | null
}

export interface ListObjectsRequest {
  connectionId: string
  bucket: string
  prefix: string
  token?: string | null
  /** Flat listing (no delimiter) walks every key under the prefix. */
  recursive?: boolean
}

/** The HTTP headers S3 serves an object with, and the metadata stored beside it. */
export interface ObjectHeaders {
  contentType?: string
  cacheControl?: string
  contentDisposition?: string
  contentEncoding?: string
  contentLanguage?: string
  /** User metadata, stored as x-amz-meta-* headers. */
  metadata?: Record<string, string>
  /** Kept so a rewrite does not silently move the object to another class. */
  storageClass?: string
}

/** One stored version of an object. A bucket without versioning has exactly one. */
export interface ObjectVersion {
  key: string
  versionId: string
  size: number
  lastModified?: string
  etag?: string
  storageClass?: string
  /** The version S3 serves when no version is named. */
  isLatest: boolean
  /**
   * A tombstone rather than data: the object appears deleted while this is the latest
   * version, and removing it brings the object back.
   */
  isDeleteMarker: boolean
}

export interface VersionActionRequest {
  connectionId: string
  bucket: string
  key: string
  versionId: string
}

export interface RestoreRequest {
  connectionId: string
  bucket: string
  keys: string[]
  /** How long the restored copy stays readable. */
  days: number
  /** Expedited, Standard or Bulk — faster costs more. */
  tier: string
}

export interface ObjectDetail {
  key: string
  size: number
  lastModified?: string
  etag?: string
  contentType?: string
  storageClass?: string
  serverSideEncryption?: string
  kmsKeyId?: string
  metadata?: Record<string, string>
  cacheControl?: string
  contentDisposition?: string
  contentEncoding?: string
  contentLanguage?: string
  /** Present while an archived object is being restored, or once it has been. */
  restoreStatus?: string
}

/** Where a profile signs in, and how its token cache is keyed. */
export interface SsoPending {
  profileName: string
  /** Code the user confirms in the browser, shown in case the browser did not open. */
  userCode: string
  verificationUri: string
}

export interface SsoLoginResult {
  profileName: string
  expiresAt: string
}

/** Settings that apply to every connection. */
export interface Preferences {
  /** How many files move at once. */
  concurrency: number
  /** Multipart chunk size in MB. Larger means fewer requests and coarser retries. */
  partSizeMb: number
  /** Combined transfer ceiling in MB/s. Zero means no limit. */
  bandwidthMbps: number
  /** Proxy URL for all AWS traffic, e.g. http://proxy.corp:3128. Empty means none. */
  proxyUrl: string
}

/** Which colour scheme the app uses. "system" follows the OS. */
export type ThemePreference = 'system' | 'light' | 'dark'

/** A KMS key a connection can see, for the key picker. */
export interface KmsKey {
  /** Full ARN — the form bucket policies are written against. */
  keyArn: string
  alias: string
  managedByAws: boolean
}

/**
 * The bucket-level settings that decide whether an operation is allowed at all.
 *
 * Every field is optional and separately denied: these are administrative reads, and an
 * ordinary user is typically allowed some and refused others. A refusal is reported as
 * such rather than as an absence, because "you cannot see this" and "this is not set"
 * mean very different things when debugging a denial.
 */
export interface BucketSettings {
  policy: string | null
  policyDenied: boolean
  versioning: 'Enabled' | 'Suspended' | 'Disabled' | 'Unknown'
  versioningDenied: boolean
  publicAccess: {
    blockPublicAcls: boolean
    ignorePublicAcls: boolean
    blockPublicPolicy: boolean
    restrictPublicBuckets: boolean
  } | null
  publicAccessDenied: boolean
  encryption: BucketEncryption | null
  encryptionDenied: boolean
  /** Rules that expire objects or move them between storage classes. */
  lifecycle: LifecycleRule[] | null
  lifecycleDenied: boolean
  /** Which origins may call this bucket from a browser. */
  cors: CorsRule[] | null
  corsDenied: boolean
  /** Where access logs are written, if anywhere. */
  logging: { targetBucket: string; targetPrefix: string } | null
  loggingDenied: boolean
  /** Static site configuration, when the bucket serves one. */
  website: { indexDocument?: string; errorDocument?: string } | null
  websiteDenied: boolean
  /** True when downloads are billed to the caller rather than the owner. */
  requesterPays: boolean | null
  requesterPaysDenied: boolean
}

export interface LifecycleRule {
  id: string
  status: string
  /** Which objects it applies to; empty means the whole bucket. */
  prefix: string
  /** Days after creation before the object is deleted, when set. */
  expirationDays?: number
  /** Storage class transitions, as days-after-creation to class. */
  transitions: Array<{ days?: number; storageClass: string }>
  /** Cleans up parts left behind by interrupted multipart uploads. */
  abortIncompleteAfterDays?: number
  noncurrentExpirationDays?: number
}

export interface CorsRule {
  allowedOrigins: string[]
  allowedMethods: string[]
  allowedHeaders: string[]
  exposeHeaders: string[]
  maxAgeSeconds?: number
}

/** A bucket's default server-side encryption, as reported by S3. */
export interface BucketEncryption {
  sseAlgorithm: string
  kmsKeyId?: string
}

export type TransferKind = 'upload' | 'download'

export type TransferStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled'

/** One file moving in one direction. The unit the transfer queue schedules and reports. */
export interface Transfer {
  id: string
  kind: TransferKind
  /** File name shown in the queue. */
  name: string
  bucket: string
  key: string
  localPath: string
  /** Total bytes, or 0 when the size is not known until the transfer starts. */
  size: number
  transferred: number
  status: TransferStatus
  error?: string
  startedAt?: string
  finishedAt?: string
  /** KMS key this upload is encrypted with, if any. */
  kmsKeyId?: string
  /** True when this upload can be paused and picked up again where it stopped. */
  resumable?: boolean
}

/**
 * How a batch of uploads should be encrypted.
 *
 * "auto" uses the connection's key, falling back to the bucket's default. "none" sends
 * no encryption headers at all — legitimate for buckets with no policy, but rejected by
 * buckets that mandate SSE-KMS, so it is a deliberate choice rather than a default.
 */
export type UploadEncryption =
  | { mode: 'auto' }
  | { mode: 'none' }
  | { mode: 'kms'; kmsKeyId: string }

export interface UploadRequest {
  connectionId: string
  bucket: string
  /** Prefix to upload into. Empty string means the bucket root. */
  prefix: string
  /** Absolute local paths. Directories are walked recursively. */
  paths: string[]
  /** Defaults to auto when omitted. */
  encryption?: UploadEncryption
  /** S3 storage class for this batch. Omitted means the bucket's default. */
  storageClass?: string
}

export interface DownloadRequest {
  connectionId: string
  bucket: string
  keys: string[]
  /** Prefixes are walked recursively and recreated as folders under the destination. */
  prefixes: string[]
  destination: string
}

/** A walk of every key under a prefix, matching names as it goes. */
export interface SearchRequest {
  connectionId: string
  bucket: string
  /** Where to start. Empty searches the whole bucket. */
  prefix: string
  query: string
  caseSensitive?: boolean
}

export interface SearchUpdate {
  id: string
  /** Keys looked at so far, which is what makes progress legible on a large bucket. */
  scanned: number
  matches: S3Object[]
  done: boolean
  cancelled?: boolean
  /** True when the result limit was reached and the walk stopped early. */
  truncated?: boolean
  error?: string
}

/** A one-way sync from a local folder into a bucket prefix. */
export interface SyncRequest {
  connectionId: string
  bucket: string
  /** Where in the bucket the folder's contents land. */
  prefix: string
  localPath: string
  /** Delete objects that no longer exist locally. Off unless asked for. */
  deleteRemote: boolean
  /** Only these are considered, when given. */
  include?: string[]
  /** These are never considered, even if included. */
  exclude?: string[]
  encryption?: UploadEncryption
}

export interface SyncPlan {
  upload: Array<{ localPath: string; key: string; size: number; reason: 'new' | 'changed' }>
  unchanged: number
  /** Files skipped by the include and exclude rules. */
  filtered: number
  deleteRemote: Array<{ key: string; size: number }>
  uploadBytes: number
}

export interface DeleteRequest {
  connectionId: string
  bucket: string
  keys: string[]
  /** Deleting a prefix deletes every object beneath it. */
  prefixes: string[]
}

export interface RenameRequest {
  connectionId: string
  bucket: string
  sourceKey: string
  targetKey: string
}

/** Copy or move objects and folders, possibly into another bucket. */
export interface TransferObjectsRequest {
  connectionId: string
  sourceBucket: string
  keys: string[]
  prefixes: string[]
  targetBucket: string
  targetPrefix: string
  /** A move deletes the source once the copy succeeds. */
  move: boolean
}

export interface SetStorageClassRequest {
  connectionId: string
  bucket: string
  keys: string[]
  storageClass: string
}

export interface CreateBucketRequest {
  connectionId: string
  name: string
  region?: string
}

export interface DeleteBucketRequest {
  connectionId: string
  name: string
}

/** What a copy or move actually did. */
export interface CopyResult {
  copied: number
  failed: Array<{ key: string; reason: string }>
}

export interface CreateFolderRequest {
  connectionId: string
  bucket: string
  prefix: string
  name: string
}

export interface PresignRequest {
  connectionId: string
  bucket: string
  key: string
  expiresInSeconds: number
}

/** What a delete actually did, so the UI can report it honestly. */
export interface DeleteResult {
  deleted: number
  /** Keys the service declined to delete, with the reason S3 gave. */
  failed: Array<{ key: string; reason: string }>
}

/** Every failure that crosses IPC arrives in this shape. */
export interface AppError {
  message: string
  /** AWS error code (`AccessDenied`, `NoSuchBucket`, `ExpiredToken`, …) when there is one. */
  code?: string
  /** True when the fix is to re-authenticate rather than retry. */
  credentialsExpired?: boolean
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }
