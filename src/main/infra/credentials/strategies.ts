import {
  fromEnv,
  fromIni,
  fromNodeProviderChain,
  fromTemporaryCredentials
} from '@aws-sdk/credential-providers'
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types'
import type { CredentialSource } from '@shared/types'
import { BucketeerError } from '../../core/errors'
import type { CredentialResolver, CredentialStrategy } from '../../core/ports'

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
 */
export class SharedProfileStrategy implements CredentialStrategy<'shared-profile'> {
  readonly kind = 'shared-profile' as const

  create(source: Extract<CredentialSource, { kind: 'shared-profile' }>): AwsCredentialIdentityProvider {
    const provider = fromIni({ profile: source.profileName })

    // The SDK's own message says to "run aws sso login with the corresponding profile",
    // which is no help to someone with four profiles configured. Naming the profile
    // turns the error into a command the user can paste.
    return async (...args) => {
      try {
        return await provider(...args)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/sso/i.test(message) && /expired|login/i.test(message)) {
          throw new BucketeerError(
            `The SSO session for profile "${source.profileName}" has expired. Run: aws sso login --profile ${source.profileName}`,
            'CredentialsProviderError'
          )
        }
        throw error
      }
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
