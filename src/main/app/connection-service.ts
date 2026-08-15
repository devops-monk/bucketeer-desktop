import type {
  Connection,
  ConnectionExport,
  ConnectionSummary,
  ExportedBase,
  ExportedCredentials,
  ImportResult,
  KmsKey,
  SsoLoginResult,
  SsoPending
} from '@shared/types'
import type {
  Clock,
  ConnectionRepository,
  CredentialResolver,
  IdGenerator,
  EventBroadcaster,
  KeyDirectory,
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
    private readonly keys: KeyDirectory,
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
   * KMS keys this connection can list, for choosing a default without typing an ARN.
   *
   * Returns an empty list rather than failing when kms:ListAliases is denied: not being
   * able to browse keys is not a reason to block the connection editor, and the key can
   * still be pasted in.
   */
  async listKmsKeys(connectionId: string): Promise<KmsKey[]> {
    try {
      return await this.keys.listKeys(await this.repository.get(connectionId))
    } catch {
      return []
    }
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
   * Everything worth sharing about the saved connections, with no secrets in it.
   *
   * A key-based connection exports as its kind alone. That makes the file safe to send
   * to a colleague or keep in a team repository, and it makes the trade honest: whoever
   * imports it has to supply their own keys, which is the correct outcome anyway.
   */
  async exportAll(): Promise<ConnectionExport> {
    const connections = await this.repository.list()

    return {
      application: 'bucketeer',
      version: 1,
      exportedAt: this.clock.nowIso(),
      connections: connections.map(({ id: _id, createdAt: _createdAt, ...rest }) => ({
        ...rest,
        credentials: stripSecrets(rest.credentials)
      }))
    }
  }

  /**
   * Adds connections from an exported file.
   *
   * Imports are additive and always get fresh ids: an import must never overwrite a
   * connection someone has already set up and signed in to. Entries needing a secret
   * this file cannot carry are reported by name rather than saved half-configured,
   * because a connection that looks ready and then fails on first use is worse than one
   * that was never created.
   */
  async importAll(payload: unknown): Promise<ImportResult> {
    const file = payload as ConnectionExport | null
    if (!file || file.application !== 'bucketeer' || !Array.isArray(file.connections)) {
      throw new Error('This is not a Bucketeer connection export.')
    }

    const result: ImportResult = { imported: 0, needCredentials: [] }
    const existing = new Set((await this.repository.list()).map((connection) => connection.name))

    for (const entry of file.connections) {
      const credentials = restore(entry.credentials)
      if (!credentials) {
        result.needCredentials.push(entry.name)
        continue
      }

      const { credentials: _credentials, ...rest } = entry
      await this.repository.save({
        ...rest,
        name: unique(entry.name, existing),
        credentials,
        id: this.ids.next(),
        createdAt: this.clock.nowIso()
      })
      result.imported += 1
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

/** Removes anything that must not be written to a file the user may share. */
function stripSecrets(source: Connection['credentials']): ExportedCredentials {
  if (source.kind === 'access-key') return { kind: 'access-key' }
  if (source.kind === 'assume-role') {
    const { base, ...rest } = source
    return { ...rest, base: stripSecrets(base) as ExportedBase }
  }
  return source
}

/**
 * Rebuilds a usable credential source, or null when the export could not carry one.
 *
 * Only access keys are lost, and only because they were deliberately not written.
 */
function restore(source: ExportedCredentials): Connection['credentials'] | null {
  if (source.kind === 'access-key') return null
  if (source.kind === 'assume-role') {
    const base = restore(source.base)
    if (!base || base.kind === 'assume-role') return null
    return { ...source, base }
  }
  return source
}

/** Keeps an imported connection distinguishable from one already on this machine. */
function unique(name: string, taken: Set<string>): string {
  let candidate = name
  let suffix = 2
  while (taken.has(candidate)) candidate = `${name} (${suffix++})`
  taken.add(candidate)
  return candidate
}
