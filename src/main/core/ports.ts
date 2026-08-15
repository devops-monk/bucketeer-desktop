import type { AwsCredentialIdentityProvider } from '@aws-sdk/types'
import type {
  Bucket,
  Connection,
  CredentialKind,
  CredentialSource,
  ListObjectsRequest,
  ListingPage,
  ObjectDetail
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

/** The storage operations the app needs, independent of S3 itself. */
export interface ObjectStorage {
  listBuckets(connection: Connection): Promise<Bucket[]>
  listObjects(connection: Connection, request: Omit<ListObjectsRequest, 'connectionId'>): Promise<ListingPage>
  headObject(connection: Connection, bucket: string, key: string): Promise<ObjectDetail>
  /** Cheap round trip that proves the credentials resolve and the endpoint answers. */
  probe(connection: Connection): Promise<{ accountId?: string; buckets: number }>
  /** Drops cached clients for a connection whose credentials may have changed. */
  forget(connectionId: string): void
  dispose(): void
}

/** Reads the AWS shared config files, for the connection editor's profile picker. */
export interface ProfileDirectory {
  listProfiles(): Promise<string[]>
}

export interface IdGenerator {
  next(): string
}

export interface Clock {
  nowIso(): string
}
