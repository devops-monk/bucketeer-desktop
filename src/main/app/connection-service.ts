import type { Connection, ConnectionSummary, SsoLoginResult, SsoPending } from '@shared/types'
import type {
  Clock,
  ConnectionRepository,
  CredentialResolver,
  IdGenerator,
  EventBroadcaster,
  ObjectStorage,
  ProfileDirectory,
  SsoAuthenticator
} from '../core/ports'

/** True when a connection resolves its credentials through the given profile. */
function usesProfile(connection: Connection, profileName: string): boolean {
  const source = connection.credentials
  if (source.kind === 'shared-profile') return source.profileName === profileName
  if (source.kind === 'assume-role') {
    return source.base.kind === 'shared-profile' && source.base.profileName === profileName
  }
  return false
}

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
    private readonly sso: SsoAuthenticator,
    private readonly broadcaster: EventBroadcaster,
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

  /**
   * Signs a profile in to IAM Identity Center.
   *
   * Afterwards every connection using that profile has its cached clients dropped:
   * they were built around a credential provider that has already failed, and would go
   * on failing against the freshly written token.
   */
  async ssoLogin(profileName: string): Promise<SsoLoginResult> {
    const result = await this.sso.login(profileName, (pending: SsoPending) =>
      this.broadcaster.ssoPending(pending)
    )

    for (const connection of await this.repository.list()) {
      if (usesProfile(connection, profileName)) this.storage.forget(connection.id)
    }
    return result
  }

  /**
   * Strips secrets while keeping the settings the editor needs to show what was saved.
   *
   * Access keys and session tokens never leave the main process; profile names, role
   * ARNs and MFA serials are configuration, not secrets, and withholding them made the
   * editor silently reset a connection's profile to whichever one happened to be first.
   */
  private summarise(connection: Connection): ConnectionSummary {
    const { credentials, ...rest } = connection

    return {
      ...rest,
      credentials: {
        kind: credentials.kind,
        label: this.credentials.describe(credentials),
        ...(credentials.kind === 'shared-profile' ? { profileName: credentials.profileName } : {}),
        ...(credentials.kind === 'assume-role'
          ? {
              roleArn: credentials.roleArn,
              sessionName: credentials.sessionName,
              externalId: credentials.externalId,
              mfaSerial: credentials.mfaSerial,
              baseProfileName:
                credentials.base.kind === 'shared-profile' ? credentials.base.profileName : undefined
            }
          : {})
      }
    }
  }
}
