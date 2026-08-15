import { describe, expect, it } from 'vitest'
import { isCredentialFailure, withFreshCredentials } from '../src/main/app/credential-retry'

/**
 * A sign-in that has just been fixed must not keep looking broken. The SDK holds onto
 * the provider it built and the answer it got, so something has to decide when that
 * answer is stale — and equally, when it is simply the truth.
 */

function failing(times: number, error: unknown): () => Promise<string> {
  let attempts = 0
  return async () => {
    attempts += 1
    if (attempts <= times) throw error
    return `succeeded on attempt ${attempts}`
  }
}

const expired = Object.assign(new Error('The SSO session has expired'), {
  name: 'CredentialsProviderError'
})

describe('recovering from a credential failure', () => {
  it('retries once with everything for that connection discarded', async () => {
    const forgotten: string[] = []
    const storage = { forget: (id: string) => forgotten.push(id) }

    const result = await withFreshCredentials(storage, 'connection-1', failing(1, expired))

    expect(result).toBe('succeeded on attempt 2')
    // Retrying without dropping the cached client would just repeat the stale answer.
    expect(forgotten).toEqual(['connection-1'])
  })

  it('gives up after the second failure rather than looping', async () => {
    let attempts = 0
    const run = async (): Promise<never> => {
      attempts += 1
      throw expired
    }

    await expect(withFreshCredentials({ forget: () => {} }, 'c', run)).rejects.toThrow(/expired/)
    expect(attempts).toBe(2)
  })

  it('does not retry a refusal, which is an answer rather than a stale session', async () => {
    let attempts = 0
    const denied = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' })
    const run = async (): Promise<never> => {
      attempts += 1
      throw denied
    }

    await expect(withFreshCredentials({ forget: () => {} }, 'c', run)).rejects.toThrow(/Denied/)
    // Retrying a real denial doubles the cost of every one of them and changes nothing.
    expect(attempts).toBe(1)
  })

  it('recognises the shapes a credential failure actually arrives in', () => {
    expect(isCredentialFailure(expired)).toBe(true)
    expect(isCredentialFailure({ name: 'ExpiredTokenException' })).toBe(true)
    expect(isCredentialFailure({ code: 'SsoRoleNotAssigned' })).toBe(true)
    expect(isCredentialFailure(new Error('The SSO session associated with this profile'))).toBe(
      true
    )

    expect(isCredentialFailure(new Error('NoSuchBucket'))).toBe(false)
    expect(isCredentialFailure({ name: 'NetworkingError' })).toBe(false)
    expect(isCredentialFailure(null)).toBe(false)
  })
})
