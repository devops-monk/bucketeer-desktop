import type { AwsCredentialIdentityProvider } from '@aws-sdk/types'
import type {
  Bucket,
  BucketSettings,
  Connection,
  CorsRule,
  CredentialKind,
  CredentialSource,
  ListObjectsRequest,
  ListingPage,
  KmsKey,
  ObjectDetail,
  ObjectHeaders,
  ObjectPreview,
  ObjectVersion,
  S3Object,
  SearchUpdate,
  SsoLoginResult,
  SsoPending,
  Transfer
} from '@shared/types'

/**
 * Ports: the interfaces the application layer depends on.
 *
 * Application services are written against these and never against a concrete adapter,
 * so swapping safeStorage for a different vault, or S3 for another object store, is an
 * adapter change rather than a rewrite. Adapters live in `../infra`.
 */

/** OS-backed encryption for data at rest. */
export interface SecretVault {
  /** False when no keychain is reachable — callers must then refuse to persist secrets. */
  isAvailable(): boolean
  seal(plaintext: string): Buffer
  open(sealed: Buffer): string
}

export interface ConnectionRepository {
  list(): Promise<Connection[]>
  get(id: string): Promise<Connection>
  save(connection: Connection): Promise<Connection>
  remove(id: string): Promise<void>
  /** Whether this repository can currently store credential material safely. */
  canStoreSecrets(): boolean
}

/**
 * One strategy per credential kind. Adding a new kind means adding a strategy and
 * registering it — no existing code changes.
 */
export interface CredentialStrategy<K extends CredentialKind = CredentialKind> {
  readonly kind: K
  create(source: Extract<CredentialSource, { kind: K }>): AwsCredentialIdentityProvider
  /** Short human-readable label, shown in the UI in place of the secret itself. */
  describe(source: Extract<CredentialSource, { kind: K }>): string
}

export interface CredentialResolver {
  resolve(source: CredentialSource): AwsCredentialIdentityProvider
  describe(source: CredentialSource): string
}

/** Reports bytes moved so far for a single transfer. */
export type ProgressReporter = (transferred: number, total?: number) => void

export interface UploadOptions {
  kmsKeyId?: string
  contentType?: string
  /** S3 storage class. Omitted means STANDARD. */
  storageClass?: string
  onProgress?: ProgressReporter
  signal?: AbortSignal
  /** Called as multipart state changes, so an interrupted upload can be resumed. */
  onResumeState?: (state: unknown | null) => void
  /** State from a previous attempt at this same file. */
  resume?: unknown
}

export interface DownloadOptions {
  onProgress?: ProgressReporter
  signal?: AbortSignal
}

/** The storage operations the app needs, independent of S3 itself. */
export interface ObjectStorage {
  listBuckets(connection: Connection): Promise<Bucket[]>
  listObjects(connection: Connection, request: Omit<ListObjectsRequest, 'connectionId'>): Promise<ListingPage>
  headObject(connection: Connection, bucket: string, key: string): Promise<ObjectDetail>

  /**
   * The bucket's default encryption, or null when there is none or we are not allowed
   * to ask. Used to satisfy policies that demand SSE-KMS headers on every upload.
   */
  getDefaultEncryption(
    connection: Connection,
    bucket: string
  ): Promise<{ sseAlgorithm: string; kmsKeyId?: string } | null>
  /** Every key under a prefix, following pagination to the end. */
  listAllKeys(connection: Connection, bucket: string, prefix: string): Promise<S3Object[]>
  /** Streams a local file up, using multipart when the file is large enough to need it. */
  putObject(
    connection: Connection,
    bucket: string,
    key: string,
    localPath: string,
    options: UploadOptions
  ): Promise<void>
  /** Streams an object down to a local path, creating parent directories as needed. */
  getObject(
    connection: Connection,
    bucket: string,
    key: string,
    localPath: string,
    options: DownloadOptions
  ): Promise<void>
  /** Batch delete. Returns the keys S3 refused, with reasons. */
  deleteObjects(
    connection: Connection,
    bucket: string,
    keys: string[]
  ): Promise<Array<{ key: string; reason: string }>>
  /**
   * Server-side copy. S3 has no move, so both rename and move are copy then delete.
   * Crossing buckets is the same call, which is why the source names its own bucket.
   */
  copyObject(
    connection: Connection,
    source: { bucket: string; key: string },
    target: { bucket: string; key: string },
    options?: { storageClass?: string; kmsKeyId?: string }
  ): Promise<void>
  /** Administrative settings, each read independently so one refusal hides only itself. */
  getBucketSettings(connection: Connection, bucket: string): Promise<BucketSettings>
  /** Replaces the CORS rules. Passing null removes the configuration. */
  putCors(connection: Connection, bucket: string, rules: CorsRule[] | null): Promise<void>
  /** Replaces the bucket policy. Passing null removes it entirely. */
  putBucketPolicy(connection: Connection, bucket: string, policy: string | null): Promise<void>
  setVersioning(connection: Connection, bucket: string, enabled: boolean): Promise<void>

  /** Creates a bucket, in the connection's region unless told otherwise. */
  createBucket(connection: Connection, name: string, region?: string): Promise<void>
  /** Deletes an empty bucket. S3 refuses while anything remains inside it. */
  deleteBucket(connection: Connection, name: string): Promise<void>
  /** Writes the zero-byte marker object that makes an empty folder visible. */
  createFolder(connection: Connection, bucket: string, key: string): Promise<void>
  presign(connection: Connection, bucket: string, key: string, expiresInSeconds: number): Promise<string>

  /**
   * Every stored version of the objects under a prefix, newest first, including the
   * delete markers that make an object look absent.
   */
  listVersions(connection: Connection, bucket: string, prefix: string): Promise<ObjectVersion[]>
  /** Copies an old version over the current one, which is how S3 "restores". */
  restoreVersion(connection: Connection, bucket: string, key: string, versionId: string): Promise<void>
  /** Removes one specific version. Unlike an ordinary delete, this cannot be undone. */
  deleteVersion(connection: Connection, bucket: string, key: string, versionId: string): Promise<void>

  /** Reads the first bytes of an object, for previewing it. */
  getObjectRange(
    connection: Connection,
    bucket: string,
    key: string,
    maxBytes: number
  ): Promise<ObjectPreview>

  /** Tags on a single object. */
  getTags(connection: Connection, bucket: string, key: string): Promise<Record<string, string>>
  putTags(
    connection: Connection,
    bucket: string,
    key: string,
    tags: Record<string, string>
  ): Promise<void>
  /**
   * Rewrites an object's headers and metadata in place. S3 has no edit, so this is a
   * copy onto itself with the directive to replace rather than keep.
   */
  replaceMetadata(
    connection: Connection,
    bucket: string,
    key: string,
    headers: ObjectHeaders
  ): Promise<void>
  /** Asks for an archived object to be made readable, and reports how that is going. */
  restoreObject(
    connection: Connection,
    bucket: string,
    key: string,
    days: number,
    tier: string
  ): Promise<void>
  /** Cheap round trip that proves the credentials resolve and the endpoint answers. */
  probe(connection: Connection): Promise<{ accountId?: string; buckets: number }>
  /** Drops cached clients for a connection whose credentials may have changed. */
  forget(connectionId: string): void
  dispose(): void
}

/** Where a profile's IAM Identity Center login happens. */
export interface SsoSettings {
  startUrl: string
  region: string
  /** Present only for profiles using an sso_session block; changes the cache key. */
  sessionName?: string
}

/** Reads the AWS shared config files, for the connection editor's profile picker. */
export interface ProfileDirectory {
  listProfiles(): Promise<string[]>
  /** Null when the profile is not an IAM Identity Center profile. */
  readSsoSettings(profileName: string): Promise<SsoSettings | null>
}

/** Opens a URL in the user's browser. A port so the login flow stays testable. */
export interface UrlOpener {
  open(url: string): Promise<void>
}

/** Lists the KMS keys a connection can see. */
export interface KeyDirectory {
  listKeys(connection: Connection): Promise<KmsKey[]>
}

/** Signs a profile in to IAM Identity Center. */
export interface SsoAuthenticator {
  login(profileName: string, onPending: (pending: SsoPending) => void): Promise<SsoLoginResult>
}

export interface IdGenerator {
  next(): string
}

export interface Clock {
  nowIso(): string
}

/** Pushes state from the main process to every open window. */
export interface EventBroadcaster {
  transfersChanged(transfers: Transfer[]): void
  ssoPending(pending: SsoPending): void
  searchUpdated(update: SearchUpdate): void
}
