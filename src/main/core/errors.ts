import type { AppError } from '@shared/types'

/** Base for failures we raise ourselves, as opposed to ones the AWS SDK throws. */
export class BucketeerError extends Error {
  readonly code: string

  constructor(message: string, code = 'BucketeerError') {
    super(message)
    this.name = 'BucketeerError'
    this.code = code
  }
}

export class ConnectionNotFoundError extends BucketeerError {
  constructor(id: string) {
    super('That connection no longer exists.', 'ConnectionNotFound')
    this.cause = id
  }
}

export class SecretStorageUnavailableError extends BucketeerError {
  constructor() {
    super(
      'This system has no secure credential storage available, so access keys cannot be saved. ' +
        'Use a shared AWS profile or the default credential chain instead.',
      'SecretStorageUnavailable'
    )
  }
}

export class StoreUnreadableError extends BucketeerError {
  constructor() {
    super(
      'Saved connections could not be read. The file may have been encrypted by a different ' +
        'user account or on a different machine.',
      'StoreUnreadable'
    )
  }
}

/** AWS error codes that mean "re-authenticate", not "retry". */
const EXPIRED_CODES = new Set([
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidClientTokenId',
  'TokenRefreshRequired',
  'CredentialsProviderError',
  'UnrecognizedClientException'
])

/**
 * Translates anything thrown in the main process into the flat shape the renderer
 * understands. AWS errors carry useful codes; we keep them and add plain-language
 * guidance for the handful users actually hit.
 */
export function toAppError(error: unknown): AppError {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }
    const code = candidate.name
    const message = candidate.message ?? 'Something went wrong.'

    if (code && EXPIRED_CODES.has(code)) {
      return { code, message: explain(code, message), credentialsExpired: true }
    }
    return { code, message: explain(code, message) }
  }
  return { message: String(error) }
}

function explain(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'AccessDenied':
      return 'Access denied. These credentials are valid but lack permission for this operation.'
    case 'NoSuchBucket':
      return 'That bucket does not exist, or it is not visible to these credentials.'
    case 'ExpiredToken':
    case 'ExpiredTokenException':
      return 'These session credentials have expired. Sign in again to refresh them.'
    case 'CredentialsProviderError':
      return 'No usable credentials were found. Check the profile or keys on this connection.'
    case 'InvalidAccessKeyId':
      return 'That access key ID is not recognised by AWS.'
    case 'SignatureDoesNotMatch':
      return 'The secret access key does not match the access key ID.'
    case 'NetworkingError':
    case 'TimeoutError':
      return 'Could not reach the endpoint. Check your network connection and endpoint URL.'
    default:
      return fallback
  }
}
