import {
  fromEnv,
  fromIni,
  fromNodeProviderChain,
  fromTemporaryCredentials
} from '@aws-sdk/credential-providers'
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types'
import type { CredentialSource } from '@shared/types'
import { BucketeerError } from '../../core/errors'
import type { CredentialResolver, CredentialStrategy, ProfileDirectory } from '../../core/ports'
import { readCachedToken } from './sso-token-cache'

/**
 * One strategy per credential kind.
 *
 * Each returns a *provider* rather than resolved credentials, so the SDK refreshes
 * expiring sessions itself — an assumed role or SSO session renews mid-session instead
 * of failing partway through a transfer.
 */

export class AccessKeyStrategy implements CredentialStrategy<'access-key'> {
  readonly kind = 'access-key' as const

  create(source: Extract<CredentialSource, { kind: 'access-key' }>): AwsCredentialIdentityProvider {
    return async () => ({
      accessKeyId: source.accessKeyId,
      secretAccessKey: source.secretAccessKey,
      sessionToken: source.sessionToken
    })
  }

  describe(source: Extract<CredentialSource, { kind: 'access-key' }>): string {
    const id = source.accessKeyId
    const masked = id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id
    return source.sessionToken ? `Temporary key ${masked}` : `Access key ${masked}`
  }
}

/**
 * Shared config profiles. fromIni deliberately covers more than plain keys: SSO / IAM
 * Identity Center, credential_process, and profiles that chain into a role through
 * source_profile all resolve through this one strategy.
 *
 * The profile directory is optional: without it the strategy still resolves credentials
 * and simply says less about why a failure happened.
 */
export class SharedProfileStrategy implements CredentialStrategy<'shared-profile'> {
  readonly kind = 'shared-profile' as const

  constructor(private readonly profiles?: ProfileDirectory) {}

  create(source: Extract<CredentialSource, { kind: 'shared-profile' }>): AwsCredentialIdentityProvider {
    let provider = fromIni({ profile: source.profileName })

    return async (...args) => {
      try {
        return await provider(...args)
      } catch (error) {
        // Start the next attempt from a fresh provider. A failed resolution otherwise
        // sticks for the life of the client, so signing in with `aws sso login` in a
        // terminal while the app is open would appear to change nothing until it was
        // restarted — the token is on disk, but nothing goes back to read it.
        provider = fromIni({ profile: source.profileName })
        throw await this.explain(source.profileName, error)
      }
    }
  }

  private async explain(profileName: string, error: unknown): Promise<unknown> {
    return explainProfileFailure(profileName, error, await this.sessionState(profileName))
  }

  private async sessionState(profileName: string): Promise<SsoSessionState> {
    if (!this.profiles) return 'unknown'
    try {
      const settings = await this.profiles.readSsoSettings(profileName)
      if (!settings) return 'unknown' // Not an SSO profile at all; keys or a process.

      const token = await readCachedToken(settings)
      if (!token) return 'missing'
      return token.expired ? 'expired' : 'valid'
    } catch {
      return 'unknown'
    }
  }

  describe(source: Extract<CredentialSource, { kind: 'shared-profile' }>): string {
    return `Profile ${source.profileName}`
  }
}

export class EnvironmentStrategy implements CredentialStrategy<'environment'> {
  readonly kind = 'environment' as const

  create(): AwsCredentialIdentityProvider {
    return fromEnv()
  }

  describe(): string {
    return 'Environment variables'
  }
}

/** The SDK's full chain: env, then shared config, then container/IMDS roles. */
export class DefaultChainStrategy implements CredentialStrategy<'default-chain'> {
  readonly kind = 'default-chain' as const

  create(): AwsCredentialIdentityProvider {
    return fromNodeProviderChain()
  }

  describe(): string {
    return 'Default credential chain'
  }
}

/**
 * sts:AssumeRole on top of another source. Takes the resolver rather than building its
 * base credentials directly, so it composes with every current and future strategy
 * without knowing what they are.
 */
export class AssumeRoleStrategy implements CredentialStrategy<'assume-role'> {
  readonly kind = 'assume-role' as const

  constructor(private readonly resolver: CredentialResolver) {}

  create(source: Extract<CredentialSource, { kind: 'assume-role' }>): AwsCredentialIdentityProvider {
    return fromTemporaryCredentials({
      masterCredentials: this.resolver.resolve(source.base),
      params: {
        RoleArn: source.roleArn,
        RoleSessionName: source.sessionName || 'bucketeer',
        ExternalId: source.externalId,
        SerialNumber: source.mfaSerial,
        DurationSeconds: source.durationSeconds
      }
    })
  }

  describe(source: Extract<CredentialSource, { kind: 'assume-role' }>): string {
    return `Role ${source.roleArn.split('/').pop() ?? source.roleArn}`
  }
}

/** What the shared SSO cache holds for a profile, as far as it can be determined. */
export type SsoSessionState = 'valid' | 'expired' | 'missing' | 'unknown'

/**
 * Says what is actually wrong with a profile's sign-in, which the SDK cannot.
 *
 * Its own message — "run aws sso login with the corresponding profile" — does not name
 * the profile, and it reads identically whether there is no session at all or a
 * perfectly good session that this particular role is simply not part of. Those need
 * completely different actions from the user, so they are told apart here by looking at
 * what the token cache holds.
 */
export function explainProfileFailure(
  profileName: string,
  error: unknown,
  session: SsoSessionState
): unknown {
  const message = error instanceof Error ? error.message : String(error)

  if (/forbidden|no access/i.test(message) && session === 'valid') {
    return new BucketeerError(
      `Signed in, but the role this profile names is not available to you. The SSO session for "${profileName}" is valid and IAM Identity Center refused the role — check sso_account_id and sso_role_name in ~/.aws/config, or ask for that role to be assigned.`,
      'SsoRoleNotAssigned'
    )
  }

  if (session === 'missing' || session === 'expired') {
    const state = session === 'missing' ? 'no SSO session' : 'an expired SSO session'
    return new BucketeerError(
      `Profile "${profileName}" has ${state}. Sign in with SSO, or run: aws sso login --profile ${profileName}`,
      'CredentialsProviderError'
    )
  }

  // Not an SSO profile, or a session that looks fine: the original message is the best
  // available account of what happened, beyond naming the profile it came from.
  if (/sso/i.test(message) && /expired|login/i.test(message)) {
    return new BucketeerError(
      `The SSO session for profile "${profileName}" has expired. Run: aws sso login --profile ${profileName}`,
      'CredentialsProviderError'
    )
  }

  return error
}
