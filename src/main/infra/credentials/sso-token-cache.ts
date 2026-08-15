import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SsoSettings } from '../../core/ports'

/**
 * The SSO token cache that the AWS CLI, the AWS SDKs and this app all share.
 *
 * Bucketeer keeps no token store of its own. Signing in here signs the `aws` CLI in
 * too, and signing in there signs this app in — which is the whole point: a session is
 * the user's, not one application's.
 *
 * The cache key is a SHA-1 of the session name when the profile uses an sso_session
 * block, and of the start URL otherwise. Get this wrong and a login appears to succeed
 * while every later request still fails as unauthenticated.
 */

export interface CachedSsoToken {
  expiresAt: string
  expired: boolean
  /** True when the token can renew itself without the user approving again. */
  renewable: boolean
}

export function cacheDirectory(): string {
  return join(homedir(), '.aws', 'sso', 'cache')
}

export function cachePathFor(settings: SsoSettings): string {
  const key = createHash('sha1').update(settings.sessionName ?? settings.startUrl).digest('hex')
  return join(cacheDirectory(), `${key}.json`)
}

/** What the shared cache currently holds for a profile, or null when it holds nothing. */
export async function readCachedToken(settings: SsoSettings): Promise<CachedSsoToken | null> {
  let raw: string
  try {
    raw = await readFile(cachePathFor(settings), 'utf8')
  } catch {
    return null // Never signed in, or signed out again. Both mean "no session".
  }

  try {
    const parsed = JSON.parse(raw) as {
      expiresAt?: string
      accessToken?: string
      refreshToken?: string
    }
    if (!parsed.accessToken || !parsed.expiresAt) return null

    return {
      expiresAt: parsed.expiresAt,
      expired: new Date(parsed.expiresAt).getTime() <= Date.now(),
      renewable: Boolean(parsed.refreshToken)
    }
  } catch {
    return null // A corrupt cache file is no session either.
  }
}

/** Writes a token in the CLI's own format, so the CLI is signed in as well. */
export async function writeCachedToken(
  settings: SsoSettings,
  registration: { clientId?: string; clientSecret?: string; clientSecretExpiresAt?: number },
  token: { accessToken: string; refreshToken?: string; expiresAt: string }
): Promise<void> {
  await mkdir(cacheDirectory(), { recursive: true })

  const payload = {
    startUrl: settings.startUrl,
    region: settings.region,
    accessToken: token.accessToken,
    // The CLI writes second-precision UTC without milliseconds; match it exactly.
    expiresAt: token.expiresAt.replace(/\.\d{3}Z$/, 'Z'),
    clientId: registration.clientId,
    clientSecret: registration.clientSecret,
    registrationExpiresAt: registration.clientSecretExpiresAt
      ? new Date(registration.clientSecretExpiresAt * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
      : undefined,
    refreshToken: token.refreshToken
  }

  await writeFile(cachePathFor(settings), JSON.stringify(payload), { mode: 0o600 })
}
