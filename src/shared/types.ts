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

/** A bucket's default server-side encryption, as reported by S3. */
export interface BucketEncryption {
  sseAlgorithm: string
  kmsKeyId?: string
}

export type TransferKind = 'upload' | 'download'

export type TransferStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

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
}

export interface DownloadRequest {
  connectionId: string
  bucket: string
  keys: string[]
  /** Prefixes are walked recursively and recreated as folders under the destination. */
  prefixes: string[]
  destination: string
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
