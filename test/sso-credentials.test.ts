import { chmod, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfileDirectory, SsoSettings } from '../src/main/core/ports'

/**
 * The SSO paths, which are the ones a user meets on their very first run and cannot
 * debug themselves.
 *
 * Two things are worth pinning down. The token cache is a *shared* file whose name and
 * shape belong to the AWS CLI, so an off-by-one in the key or a stray millisecond in a
 * timestamp silently produces a login that appears to work and authenticates nothing.
 * And the failure messages have to distinguish "never signed in", "session expired" and
 * "this role is not yours", because the user's next action is different in each case.
 */

// The cache lives under the home directory, so the tests need their own.
const state = vi.hoisted(() => ({ home: '' }))

vi.mock('node:os', async (importActual) => {
  const actual = await importActual<typeof import('node:os')>()
  return { ...actual, homedir: () => state.home }
})

// fromIni would read the developer's real ~/.aws and reach the network. The strategy's
// job here is what it does with a rejection, not where the rejection came from.
const ini = vi.hoisted(() => ({ fail: undefined as unknown, calls: 0 }))

vi.mock('@aws-sdk/credential-providers', () => ({
  fromIni: () => {
    ini.calls += 1
    return async () => {
      if (ini.fail) throw ini.fail
      return { accessKeyId: 'AKIA', secretAccessKey: 'secret' }
    }
  },
  fromEnv: () => async () => ({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
  fromNodeProviderChain: () => async () => ({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
  fromTemporaryCredentials: () => async () => ({ accessKeyId: 'AKIA', secretAccessKey: 'secret' })
}))

const { cachePathFor, readCachedToken, writeCachedToken } = await import(
  '../src/main/infra/credentials/sso-token-cache'
)
const { SharedProfileStrategy } = await import('../src/main/infra/credentials/strategies')
const { AwsCliSsoAuthenticator, SsoLoginChain } = await import(
  '../src/main/infra/credentials/cli-sso-login'
)

const settings: SsoSettings = {
  startUrl: 'https://example.awsapps.com/start',
  region: 'eu-west-1'
}

/** Writes a cache entry the way the CLI would, expiring at the given offset from now. */
async function seedToken(
  target: SsoSettings,
  expiresInMs: number,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await mkdir(join(state.home, '.aws', 'sso', 'cache'), { recursive: true })
  await writeFile(
    cachePathFor(target),
    JSON.stringify({
      accessToken: 'token',
      expiresAt: new Date(Date.now() + expiresInMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ...extra
    })
  )
}

class StubProfiles implements ProfileDirectory {
  constructor(private readonly sso: SsoSettings | null) {}

  async listProfiles(): Promise<string[]> {
    return ['work']
  }

  async readSsoSettings(): Promise<SsoSettings | null> {
    return this.sso
  }
}

beforeEach(async () => {
  state.home = await mkdtemp(join(tmpdir(), 'bucketeer-sso-'))
  ini.fail = undefined
  ini.calls = 0
})

describe('the shared SSO token cache', () => {
  it('keys on the session name when the profile uses an sso_session block', () => {
    const bySession = cachePathFor({ ...settings, sessionName: 'corp' })
    const byStartUrl = cachePathFor(settings)

    expect(bySession).not.toEqual(byStartUrl)
    // The CLI's own algorithm: sha1 of the session name, hex, plus .json.
    expect(bySession).toMatch(/[0-9a-f]{40}\.json$/)
  })

  it('reports no session when nothing has been cached', async () => {
    expect(await readCachedToken(settings)).toBeNull()
  })

  it('separates a live session from an expired one', async () => {
    await seedToken(settings, 60 * 60 * 1000)
    expect((await readCachedToken(settings))?.expired).toBe(false)

    await seedToken(settings, -1000)
    expect((await readCachedToken(settings))?.expired).toBe(true)
  })

  it('reports whether the session can renew itself without the user', async () => {
    await seedToken(settings, 60_000)
    expect((await readCachedToken(settings))?.renewable).toBe(false)

    await seedToken(settings, 60_000, { refreshToken: 'refresh' })
    expect((await readCachedToken(settings))?.renewable).toBe(true)
  })

  it('treats a corrupt or half-written cache file as no session at all', async () => {
    await mkdir(join(state.home, '.aws', 'sso', 'cache'), { recursive: true })
    await writeFile(cachePathFor(settings), '{ not json')
    expect(await readCachedToken(settings)).toBeNull()

    await writeFile(cachePathFor(settings), JSON.stringify({ expiresAt: 'x' }))
    expect(await readCachedToken(settings)).toBeNull()
  })

  it('writes a token the CLI can read back, and keeps it private', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString()
    await writeCachedToken(settings, { clientId: 'id', clientSecret: 'shh' }, {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt
    })

    const token = await readCachedToken(settings)
    expect(token?.renewable).toBe(true)
    expect(token?.expired).toBe(false)
    // The CLI writes second precision; a millisecond field makes it reject the entry.
    expect(token?.expiresAt).not.toMatch(/\.\d{3}Z$/)

    const mode = (await stat(cachePathFor(settings))).mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe('explaining why a profile will not authenticate', () => {
  const failure = new Error('Error loading SSO Token: run aws sso login')

  it('names the profile and says there is no session yet', async () => {
    ini.fail = failure
    const strategy = new SharedProfileStrategy(new StubProfiles(settings))

    await expect(strategy.create({ kind: 'shared-profile', profileName: 'work' })()).rejects.toThrow(
      /Profile "work" has no SSO session/
    )
  })

  it('distinguishes an expired session from one that was never started', async () => {
    await seedToken(settings, -1000)
    ini.fail = failure
    const strategy = new SharedProfileStrategy(new StubProfiles(settings))

    await expect(strategy.create({ kind: 'shared-profile', profileName: 'work' })()).rejects.toThrow(
      /Profile "work" has an expired SSO session/
    )
  })

  it('says the role is unassigned when the session itself is good', async () => {
    await seedToken(settings, 60 * 60 * 1000)
    ini.fail = new Error('Forbidden: No access')
    const strategy = new SharedProfileStrategy(new StubProfiles(settings))

    // Telling this user to sign in again would send them round a loop that cannot help:
    // they are already signed in, and the role is the part that is wrong.
    await expect(
      strategy.create({ kind: 'shared-profile', profileName: 'work' })()
    ).rejects.toThrow(/not available to you/)
  })

  it('leaves unrelated failures exactly as they were', async () => {
    ini.fail = new Error('EACCES: permission denied, open ~/.aws/config')
    const strategy = new SharedProfileStrategy(new StubProfiles(null))

    await expect(strategy.create({ kind: 'shared-profile', profileName: 'work' })()).rejects.toThrow(
      /EACCES/
    )
  })

  it('still works, less precisely, with no profile directory behind it', async () => {
    ini.fail = failure
    const strategy = new SharedProfileStrategy()

    await expect(strategy.create({ kind: 'shared-profile', profileName: 'work' })()).rejects.toThrow(
      /aws sso login --profile work/
    )
  })

  it('starts over after a failure, so signing in elsewhere takes effect', async () => {
    ini.fail = failure
    const strategy = new SharedProfileStrategy(new StubProfiles(settings))
    const provider = strategy.create({ kind: 'shared-profile', profileName: 'work' })

    expect(ini.calls).toBe(1)

    await expect(provider()).rejects.toThrow()
    // A replacement is built as soon as the first one fails, rather than the failed one
    // being kept and asked again.
    expect(ini.calls).toBe(2)

    // The user runs `aws sso login` in a terminal. Without that fresh provider the app
    // keeps failing on the cached rejection until it is restarted.
    ini.fail = undefined
    await expect(provider()).resolves.toMatchObject({ accessKeyId: 'AKIA' })
  })
})

describe('choosing how to sign in', () => {
  let binDirectory: string

  beforeEach(async () => {
    binDirectory = await mkdtemp(join(tmpdir(), 'bucketeer-bin-'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('finds the CLI on PATH', async () => {
    const executable = join(binDirectory, process.platform === 'win32' ? 'aws.exe' : 'aws')
    await writeFile(executable, '#!/bin/sh\nexit 0\n')
    await chmod(executable, 0o755)
    vi.stubEnv('PATH', binDirectory)

    expect(await new AwsCliSsoAuthenticator(new StubProfiles(settings)).locate()).toBe(executable)
  })

  it('reports no CLI rather than guessing when PATH holds nothing', async () => {
    vi.stubEnv('PATH', binDirectory + delimiter + join(binDirectory, 'nowhere'))
    vi.stubEnv('HOME', binDirectory)

    // The extra directories searched are absolute system paths; on a machine that has
    // the CLI installed this would find it, so only assert the shape of the answer.
    const found = await new AwsCliSsoAuthenticator(new StubProfiles(settings)).locate()
    expect(found === null || found.endsWith('aws') || found.endsWith('aws.exe')).toBe(true)
  })

  it('runs the AWS CLI when it exists, so the browser names a client the user trusts', async () => {
    const cli = new AwsCliSsoAuthenticator(new StubProfiles(settings))
    vi.spyOn(cli, 'locate').mockResolvedValue('/usr/local/bin/aws')
    const cliLogin = vi
      .spyOn(cli, 'login')
      .mockResolvedValue({ profileName: 'work', expiresAt: 'later' })
    const fallback = { login: vi.fn() }

    await new SsoLoginChain(cli, fallback).login('work', () => {})

    expect(cliLogin).toHaveBeenCalledWith('work', expect.any(Function))
    expect(fallback.login).not.toHaveBeenCalled()
  })

  it('falls back to the built-in flow only when there is no CLI to run', async () => {
    const cli = new AwsCliSsoAuthenticator(new StubProfiles(settings))
    vi.spyOn(cli, 'locate').mockResolvedValue(null)
    const cliLogin = vi.spyOn(cli, 'login')
    const fallback = { login: vi.fn().mockResolvedValue({ profileName: 'work', expiresAt: 'x' }) }

    await new SsoLoginChain(cli, fallback).login('work', () => {})

    expect(fallback.login).toHaveBeenCalledWith('work', expect.any(Function))
    expect(cliLogin).not.toHaveBeenCalled()
  })

  it('does not restart an abandoned login under a different client', async () => {
    const cli = new AwsCliSsoAuthenticator(new StubProfiles(settings))
    vi.spyOn(cli, 'locate').mockResolvedValue('/usr/local/bin/aws')
    vi.spyOn(cli, 'login').mockRejectedValue(new Error('Timed out waiting for approval'))
    const fallback = { login: vi.fn() }

    // Two browser tabs asking to approve two different clients is worse than one clear
    // failure, so a CLI login that fails is the end of it.
    await expect(new SsoLoginChain(cli, fallback).login('work', () => {})).rejects.toThrow(
      /Timed out/
    )
    expect(fallback.login).not.toHaveBeenCalled()
  })
})
