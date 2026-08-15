import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CreateTokenCommand,
  RegisterClientCommand,
  SSOOIDCClient,
  StartDeviceAuthorizationCommand
} from '@aws-sdk/client-sso-oidc'
import type { SsoLoginResult, SsoPending } from '@shared/types'
import { BucketeerError } from '../../core/errors'
import type { ProfileDirectory, SsoAuthenticator, UrlOpener } from '../../core/ports'

/** Give up if the user has not approved within this long. */
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000
/** Fallback poll interval when the service does not supply one. */
const DEFAULT_INTERVAL_MS = 5000

/**
 * IAM Identity Center login by device authorization — the same flow `aws sso login`
 * uses, run from inside the app.
 *
 * The resulting token is written to the shared SSO cache in the CLI's own format, which
 * has two consequences worth stating: the existing credential path picks it up with no
 * special casing, and the user's `aws` CLI is signed in too. Bucketeer stores nothing
 * of its own.
 */
export class DeviceCodeSsoAuthenticator implements SsoAuthenticator {
  constructor(
    private readonly profiles: ProfileDirectory,
    private readonly opener: UrlOpener
  ) {}

  async login(profileName: string, onPending: (pending: SsoPending) => void): Promise<SsoLoginResult> {
    const settings = await this.profiles.readSsoSettings(profileName)
    if (!settings) {
      throw new BucketeerError(
        `Profile "${profileName}" is not configured for IAM Identity Center, so there is nothing to sign in to.`,
        'NotAnSsoProfile'
      )
    }

    const client = new SSOOIDCClient({ region: settings.region })
    try {
      const registration = await client.send(
        new RegisterClientCommand({
          clientName: 'bucketeer',
          clientType: 'public',
          scopes: ['sso:account:access']
        })
      )

      const authorization = await client.send(
        new StartDeviceAuthorizationCommand({
          clientId: registration.clientId,
          clientSecret: registration.clientSecret,
          startUrl: settings.startUrl
        })
      )

      const verificationUri =
        authorization.verificationUriComplete ?? authorization.verificationUri ?? settings.startUrl

      // Tell the UI before opening the browser: if the browser fails to open, or opens
      // behind the app, the user still has the code and the URL on screen.
      onPending({
        profileName,
        userCode: authorization.userCode ?? '',
        verificationUri
      })
      await this.opener.open(verificationUri)

      const token = await this.poll(client, registration, authorization)
      await writeTokenCache(settings, registration, token)

      return { profileName, expiresAt: token.expiresAt }
    } finally {
      client.destroy()
    }
  }

  /**
   * Polls until the user approves in the browser. AuthorizationPending is the normal
   * state for most of this loop, and SlowDown means back off — treating either as a
   * failure would abandon a login the user is in the middle of completing.
   */
  private async poll(
    client: SSOOIDCClient,
    registration: { clientId?: string; clientSecret?: string },
    authorization: { deviceCode?: string; interval?: number }
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt: string }> {
    let interval = (authorization.interval ?? 5) * 1000 || DEFAULT_INTERVAL_MS
    const deadline = Date.now() + LOGIN_TIMEOUT_MS

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, interval))

      try {
        const result = await client.send(
          new CreateTokenCommand({
            clientId: registration.clientId,
            clientSecret: registration.clientSecret,
            grantType: 'urn:ietf:params:oauth:grant-type:device_code',
            deviceCode: authorization.deviceCode
          })
        )
        if (!result.accessToken) throw new BucketeerError('Sign-in returned no token.', 'SsoLoginFailed')

        return {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: new Date(Date.now() + (result.expiresIn ?? 3600) * 1000).toISOString()
        }
      } catch (error) {
        const name = (error as { name?: string }).name
        if (name === 'AuthorizationPendingException') continue
        if (name === 'SlowDownException') {
          interval += 5000
          continue
        }
        if (name === 'ExpiredTokenException') {
          throw new BucketeerError(
            'The sign-in request expired before it was approved. Try again.',
            'SsoLoginExpired'
          )
        }
        throw error
      }
    }

    throw new BucketeerError(
      'Timed out waiting for the sign-in to be approved in the browser.',
      'SsoLoginTimeout'
    )
  }
}

/**
 * Writes the token where the AWS SDK and CLI look for it.
 *
 * The cache key is a SHA-1 of the session name when the profile uses an sso_session
 * block, and of the start URL otherwise — get this wrong and the login appears to
 * succeed while every later request still fails as unauthenticated.
 */
async function writeTokenCache(
  settings: { startUrl: string; region: string; sessionName?: string },
  registration: { clientId?: string; clientSecret?: string; clientSecretExpiresAt?: number },
  token: { accessToken: string; refreshToken?: string; expiresAt: string }
): Promise<void> {
  const cacheDirectory = join(homedir(), '.aws', 'sso', 'cache')
  await mkdir(cacheDirectory, { recursive: true })

  const key = createHash('sha1').update(settings.sessionName ?? settings.startUrl).digest('hex')
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

  await writeFile(join(cacheDirectory, `${key}.json`), JSON.stringify(payload), { mode: 0o600 })
}
