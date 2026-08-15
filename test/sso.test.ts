import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SsoPending } from '@shared/types'
import { AwsCliSsoAuthenticator, SsoLoginChain } from '../src/main/infra/credentials/cli-sso-login'
import { SharedConfigProfileDirectory } from '../src/main/infra/credentials/profile-directory'
import { explainProfileFailure } from '../src/main/infra/credentials/strategies'
import { readCachedToken } from '../src/main/infra/credentials/sso-token-cache'

/**
 * Signing in is where this app touches the user's own AWS setup, so the rules are
 * strict: a session created anywhere must work everywhere, and nothing here may invent
 * its own store of tokens.
 */

const START_URL = 'https://example.awsapps.com/start'
const SETTINGS = { startUrl: START_URL, region: 'eu-west-1' }

let home: string
let originalHome: string | undefined
let originalPath: string | undefined

/** os.homedir() reads $HOME, so a temporary one gives us a whole fake ~/.aws. */
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'bucketeer-home-'))
  originalHome = process.env.HOME
  originalPath = process.env.PATH
  process.env.HOME = home
  await mkdir(join(home, '.aws', 'sso', 'cache'), { recursive: true })
})

afterEach(async () => {
  process.env.HOME = originalHome
  process.env.PATH = originalPath
  delete process.env.AWS_CONFIG_FILE
  await rm(home, { recursive: true, force: true })
})

/** Writes a token where the AWS CLI would have written one. */
async function writeToken(expiresAt: string, extra: Record<string, unknown> = {}): Promise<void> {
  const { createHash } = await import('node:crypto')
  const key = createHash('sha1').update(START_URL).digest('hex')
  await writeFile(
    join(home, '.aws', 'sso', 'cache', `${key}.json`),
    JSON.stringify({ startUrl: START_URL, region: 'eu-west-1', accessToken: 'token', expiresAt, ...extra })
  )
}

describe('the shared SSO token cache', () => {
  it('reads a session the AWS CLI wrote', async () => {
    const expiresAt = new Date(Date.now() + 3600_000).toISOString()
    await writeToken(expiresAt, { refreshToken: 'refresh' })

    const token = await readCachedToken(SETTINGS)
    expect(token).toEqual({ expiresAt, expired: false, renewable: true })
  })

  it('reports an expired session as expired rather than absent', async () => {
    await writeToken(new Date(Date.now() - 60_000).toISOString())

    expect((await readCachedToken(SETTINGS))?.expired).toBe(true)
  })

  it('treats a missing or unreadable cache as no session', async () => {
    expect(await readCachedToken(SETTINGS)).toBeNull()

    const { createHash } = await import('node:crypto')
    const key = createHash('sha1').update(START_URL).digest('hex')
    await writeFile(join(home, '.aws', 'sso', 'cache', `${key}.json`), 'not json')
    expect(await readCachedToken(SETTINGS)).toBeNull()
  })

  it('keys on the session name when the profile uses an sso_session block', async () => {
    const { createHash } = await import('node:crypto')
    const key = createHash('sha1').update('very-sso').digest('hex')
    await writeFile(
      join(home, '.aws', 'sso', 'cache', `${key}.json`),
      JSON.stringify({ accessToken: 'token', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    )

    // Keyed on the start URL instead, this finds nothing and the login looks broken.
    expect(await readCachedToken({ ...SETTINGS, sessionName: 'very-sso' })).not.toBeNull()
  })
})

describe('explaining why a profile would not resolve', () => {
  const forbidden = new Error('ForbiddenException: No access')

  it('separates a role you cannot use from a session you do not have', () => {
    const withSession = explainProfileFailure('non-prd-fs', forbidden, 'valid') as Error
    expect(withSession.message).toMatch(/not available to you/)
    // The actionable part: it is the profile's role, not the sign-in, that is wrong.
    expect(withSession.message).toMatch(/sso_role_name/)

    const withoutSession = explainProfileFailure('non-prd-fs', forbidden, 'missing') as Error
    expect(withoutSession.message).toMatch(/no SSO session/)
  })

  it('always names the profile, which the SDK never does', () => {
    const expired = new Error(
      'The SSO session associated with this profile has expired. To refresh this SSO session run aws sso login with the corresponding profile.'
    )

    for (const state of ['expired', 'unknown'] as const) {
      expect((explainProfileFailure('very-copilot', expired, state) as Error).message).toContain(
        'aws sso login --profile very-copilot'
      )
    }
  })

  it('leaves an unrelated failure exactly as it was', () => {
    const network = new Error('getaddrinfo ENOTFOUND s3.eu-west-1.amazonaws.com')
    expect(explainProfileFailure('code', network, 'valid')).toBe(network)
  })
})

describe('signing in through the AWS CLI', () => {
  /** A stand-in for `aws` that behaves the way the real one does on this path. */
  async function fakeCli(body: string): Promise<string> {
    const directory = join(home, 'bin')
    await mkdir(directory, { recursive: true })
    const path = join(directory, 'aws')
    await writeFile(path, `#!/bin/sh\n${body}\n`)
    await chmod(path, 0o755)
    return directory
  }

  it('finds an executable aws on PATH, and ignores one that cannot run', async () => {
    const authenticator = new AwsCliSsoAuthenticator({} as never)

    const directory = await fakeCli('exit 0')
    process.env.PATH = directory
    expect(await authenticator.locate()).toBe(join(directory, 'aws'))

    // A file sitting there without the execute bit is not a CLI, and treating it as one
    // turns a missing CLI into a confusing spawn failure.
    await chmod(join(directory, 'aws'), 0o644)
    const found = await authenticator.locate()
    expect(found === null || found !== join(directory, 'aws')).toBe(true)
  })

  it('runs aws sso login for the chosen profile and reports the code it prints', async () => {
    const directory = await fakeCli(
      `echo "Attempting to automatically open the SSO authorization page..."
       echo "https://device.sso.eu-west-1.amazonaws.com/?user_code=WXYZ-1234"
       echo "Then enter the code: WXYZ-1234"
       echo "$@" > "${home}/called.txt"`
    )
    process.env.PATH = `${directory}:${process.env.PATH}`

    const expiresAt = new Date(Date.now() + 3600_000).toISOString()
    await writeToken(expiresAt)
    await writeFile(
      join(home, 'config'),
      `[profile non-prd-fs]\nsso_start_url = ${START_URL}\nsso_region = eu-west-1\n`
    )
    process.env.AWS_CONFIG_FILE = join(home, 'config')

    const pending: SsoPending[] = []
    const result = await new AwsCliSsoAuthenticator(new SharedConfigProfileDirectory()).login(
      'non-prd-fs',
      (update) => pending.push(update)
    )

    // Exactly the command the user would have typed, with their profile.
    const { readFile } = await import('node:fs/promises')
    expect((await readFile(join(home, 'called.txt'), 'utf8')).trim()).toBe(
      'sso login --profile non-prd-fs'
    )

    expect(pending.some((update) => update.userCode === 'WXYZ-1234')).toBe(true)
    expect(pending.some((update) => update.verificationUri.includes('device.sso'))).toBe(true)
    // The expiry shown to the user comes from the cache the CLI wrote, not a guess.
    expect(result.expiresAt).toBe(expiresAt)
  })

  it('surfaces the CLI’s own diagnosis when it fails', async () => {
    const directory = await fakeCli('echo "Error loading SSO Token: something is wrong" >&2\nexit 1')
    process.env.PATH = `${directory}:${process.env.PATH}`
    await writeFile(join(home, 'config'), `[profile p]\nsso_start_url = ${START_URL}\n`)
    process.env.AWS_CONFIG_FILE = join(home, 'config')

    await expect(
      new AwsCliSsoAuthenticator(new SharedConfigProfileDirectory()).login('p', () => {})
    ).rejects.toThrow(/something is wrong/)
  })

  it('falls back to the built-in flow only when there is no CLI to run', async () => {
    let fellBack = false
    const fallback = {
      login: async () => {
        fellBack = true
        return { profileName: 'p', expiresAt: 'never' }
      }
    }

    const missing = new AwsCliSsoAuthenticator({} as never)
    missing.locate = async () => null
    await new SsoLoginChain(missing, fallback).login('p', () => {})
    expect(fellBack).toBe(true)

    fellBack = false
    const present = new AwsCliSsoAuthenticator({} as never)
    present.locate = async () => '/usr/local/bin/aws'
    present.login = async () => ({ profileName: 'p', expiresAt: 'soon' })
    await new SsoLoginChain(present, fallback).login('p', () => {})
    expect(fellBack).toBe(false)
  })
})
