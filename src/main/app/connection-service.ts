import type { Connection, ConnectionSummary } from '@shared/types'
import type {
  Clock,
  ConnectionRepository,
  CredentialResolver,
  IdGenerator,
  ObjectStorage,
  ProfileDirectory
} from '../core/ports'

export type ConnectionDraft = Omit<Connection, 'id' | 'createdAt'> & { id?: string }

/**
 * Use cases for managing connections. Depends only on ports, so it can be exercised
 * with in-memory doubles and knows nothing about Electron, the filesystem, or S3.
 */
export class ConnectionService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly credentials: CredentialResolver,
    private readonly storage: ObjectStorage,
    private readonly profiles: ProfileDirectory,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  async list(): Promise<ConnectionSummary[]> {
    return (await this.repository.list()).map((connection) => this.summarise(connection))
  }

  async save(draft: ConnectionDraft): Promise<ConnectionSummary> {
    const existing = draft.id ? await this.repository.get(draft.id).catch(() => null) : null

    const connection: Connection = {
      ...draft,
      id: existing?.id ?? this.ids.next(),
      createdAt: existing?.createdAt ?? this.clock.nowIso()
    }

    const saved = await this.repository.save(connection)
    // Credentials or endpoint may have changed, so any cached client is now suspect.
    this.storage.forget(saved.id)
    return this.summarise(saved)
  }

  async remove(id: string): Promise<void> {
    await this.repository.remove(id)
    this.storage.forget(id)
  }

  async test(id: string): Promise<{ accountId?: string; buckets: number }> {
    return this.storage.probe(await this.repository.get(id))
  }

  secretsAvailable(): boolean {
    return this.repository.canStoreSecrets()
  }

  async sharedProfiles(): Promise<string[]> {
    return this.profiles.listProfiles()
  }

  /** Drops credentials to a label — the renderer must never receive the real thing. */
  private summarise(connection: Connection): ConnectionSummary {
    const { credentials, ...rest } = connection
    return {
      ...rest,
      credentials: { kind: credentials.kind, label: this.credentials.describe(credentials) }
    }
  }
}
