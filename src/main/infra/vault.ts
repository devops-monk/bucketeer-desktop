import { safeStorage } from 'electron'
import type { SecretVault } from '../core/ports'

/**
 * SecretVault backed by Electron safeStorage: Keychain on macOS, DPAPI on Windows,
 * libsecret/kwallet on Linux. Chosen over keytar, which is unmaintained and needs a
 * native build step.
 */
export class SafeStorageVault implements SecretVault {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  seal(plaintext: string): Buffer {
    return safeStorage.encryptString(plaintext)
  }

  open(sealed: Buffer): string {
    return safeStorage.decryptString(sealed)
  }
}

/**
 * Null-object vault for systems with no secret service. It reports unavailable, which
 * makes the repository reject any connection carrying secrets rather than writing keys
 * to disk in the clear.
 */
export class UnavailableVault implements SecretVault {
  isAvailable(): boolean {
    return false
  }

  seal(): Buffer {
    throw new Error('No secure storage is available on this system.')
  }

  open(): string {
    throw new Error('No secure storage is available on this system.')
  }
}
