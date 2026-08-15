import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Connection, CredentialSource } from '@shared/types'
import { ConnectionNotFoundError, SecretStorageUnavailableError, StoreUnreadableError } from '../core/errors'
import type { ConnectionRepository, SecretVault } from '../core/ports'

interface StoreFile {
  version: 1
  connections: Connection[]
}

const ENCRYPTED_FILE = 'connections.enc'
const PLAINTEXT_FILE = 'connections.json'

/**
 * Connections persisted as one file, encrypted whole rather than field by field, so
 * an attacker reading the disk learns nothing — not even which endpoints are in use.
 *
 * When no vault is available the repository falls back to a plaintext file and refuses
 * to accept any connection carrying secrets, so credentials are never silently exposed.
 */
export class FileConnectionRepository implements ConnectionRepository {
  private cache: StoreFile | null = null

  constructor(
    private readonly vault: SecretVault,
    private readonly directory: string
  ) {}

  canStoreSecrets(): boolean {
    return this.vault.isAvailable()
  }

  async list(): Promise<Connection[]> {
    return (await this.read()).connections
  }

  async get(id: string): Promise<Connection> {
    const found = (await this.read()).connections.find((c) => c.id === id)
    if (!found) throw new ConnectionNotFoundError(id)
    return found
  }

  async save(connection: Connection): Promise<Connection> {
    if (!this.canStoreSecrets() && carriesSecrets(connection.credentials)) {
      throw new SecretStorageUnavailableError()
    }

    const store = await this.read()
    const exists = store.connections.some((c) => c.id === connection.id)
    const connections = exists
      ? store.connections.map((c) => (c.id === connection.id ? connection : c))
      : [...store.connections, connection]

    await this.write({ version: 1, connections })
    return connection
  }

  async remove(id: string): Promise<void> {
    const store = await this.read()
    await this.write({ version: 1, connections: store.connections.filter((c) => c.id !== id) })
  }

  private path(encrypted: boolean): string {
    return join(this.directory, encrypted ? ENCRYPTED_FILE : PLAINTEXT_FILE)
  }

  private async read(): Promise<StoreFile> {
    if (this.cache) return this.cache

    if (this.vault.isAvailable()) {
      try {
        const sealed = await readFile(this.path(true))
        this.cache = JSON.parse(this.vault.open(sealed)) as StoreFile
        return this.cache
      } catch (error) {
        // A decryption failure must not be mistaken for "no connections yet" — that
        // would quietly hand the user an empty app and then overwrite their store.
        if (!isMissingFile(error)) throw new StoreUnreadableError()
      }
    }

    try {
      this.cache = JSON.parse(await readFile(this.path(false), 'utf8')) as StoreFile
    } catch (error) {
      if (!isMissingFile(error)) throw new StoreUnreadableError()
      this.cache = { version: 1, connections: [] }
    }
    return this.cache
  }

  private async write(next: StoreFile): Promise<void> {
    const payload = JSON.stringify(next, null, 2)
    const encrypted = this.vault.isAvailable()
    const target = this.path(encrypted)
    const temp = `${target}.tmp`

    // Write to a temp file and rename, so an interrupted save cannot truncate the store.
    if (encrypted) {
      await writeFile(temp, this.vault.seal(payload), { mode: 0o600 })
    } else {
      if (next.connections.some((c) => carriesSecrets(c.credentials))) {
        throw new SecretStorageUnavailableError()
      }
      await writeFile(temp, payload, { mode: 0o600, encoding: 'utf8' })
    }
    await rename(temp, target)
    this.cache = next
  }
}

/** True when a source holds material that must never touch disk unencrypted. */
function carriesSecrets(source: CredentialSource): boolean {
  if (source.kind === 'access-key') return true
  if (source.kind === 'assume-role') return carriesSecrets(source.base)
  return false
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}
