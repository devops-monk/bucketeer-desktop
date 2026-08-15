/**
 * Recovering from a credential failure that has since been fixed.
 *
 * The AWS SDK builds a credential provider once and a client holds onto it. When the
 * provider fails — an expired SSO session, a role that could not be assumed — the client
 * keeps that answer, so signing in afterwards (in a terminal, or through the button in
 * this app) changes nothing until something goes back and looks at the token file again.
 * That is why a fixed sign-in could still look broken.
 *
 * So a failure that names the credentials is retried exactly once, from a client built
 * from scratch. Once, because a second identical failure is the real answer, and paying
 * for it twice on every genuine denial helps nobody.
 */

/** Errors that mean "the credentials could not be produced", not "you may not do that". */
const CREDENTIAL_CODES = new Set([
  'CredentialsProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidClientTokenId',
  'UnrecognizedClientException',
  'SsoRoleNotAssigned'
])

export function isCredentialFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: string; code?: string; message?: string }

  if (candidate.name && CREDENTIAL_CODES.has(candidate.name)) return true
  if (candidate.code && CREDENTIAL_CODES.has(candidate.code)) return true
  // An expired *session* is a credential problem however the SDK spelled it.
  return /sso session|token (has )?expired|credentials/i.test(candidate.message ?? '')
}

/**
 * Runs the work, and on a credential failure discards everything cached for the
 * connection and runs it once more.
 */
export async function withFreshCredentials<T>(
  storage: { forget(connectionId: string): void },
  connectionId: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!isCredentialFailure(error)) throw error

    storage.forget(connectionId)
    return run()
  }
}
