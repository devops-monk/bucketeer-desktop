import type { AwsCredentialIdentityProvider } from '@aws-sdk/types'
import type { CredentialKind, CredentialSource } from '@shared/types'
import { BucketeerError } from '../../core/errors'
import type { CredentialResolver, CredentialStrategy } from '../../core/ports'
import {
  AccessKeyStrategy,
  AssumeRoleStrategy,
  DefaultChainStrategy,
  EnvironmentStrategy,
  SharedProfileStrategy
} from './strategies'

/**
 * Dispatches a CredentialSource to its strategy.
 *
 * Supporting a new credential kind means writing a strategy and registering it here;
 * nothing that consumes the resolver has to change.
 */
export class StrategyCredentialResolver implements CredentialResolver {
  private readonly strategies = new Map<CredentialKind, CredentialStrategy>()

  register(strategy: CredentialStrategy): this {
    this.strategies.set(strategy.kind, strategy)
    return this
  }

  resolve(source: CredentialSource): AwsCredentialIdentityProvider {
    return this.strategyFor(source).create(source as never)
  }

  describe(source: CredentialSource): string {
    return this.strategyFor(source).describe(source as never)
  }

  private strategyFor(source: CredentialSource): CredentialStrategy {
    const strategy = this.strategies.get(source.kind)
    if (!strategy) {
      throw new BucketeerError(
        `This connection uses an unsupported credential type (${source.kind}).`,
        'UnsupportedCredentialKind'
      )
    }
    return strategy
  }
}

/** Builds the resolver with every strategy Bucketeer ships with. */
export function createCredentialResolver(): CredentialResolver {
  const resolver = new StrategyCredentialResolver()
  return resolver
    .register(new AccessKeyStrategy())
    .register(new SharedProfileStrategy())
    .register(new EnvironmentStrategy())
    .register(new DefaultChainStrategy())
    // Assume-role composes with the others, so it takes the resolver it lives in.
    .register(new AssumeRoleStrategy(resolver))
}
