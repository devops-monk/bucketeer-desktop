import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { SsoLoginResult, SsoPending } from '@shared/types'
import { BucketeerError } from '../../core/errors'
import type { ProfileDirectory, SsoAuthenticator } from '../../core/ports'
import { readCachedToken } from './sso-token-cache'

/** Long enough for a browser approval, including finding the right tab. */
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000

/**
 * Directories a GUI application has to look in itself.
 *
 * An app launched from the Dock or Start menu inherits a minimal PATH — not the shell's
 * — so a CLI that works perfectly in a terminal is simply invisible here unless its
 * usual homes are checked directly.
 */
const EXTRA_DIRECTORIES = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
  '/opt/local/bin',
  join(process.env.HOME ?? '', '.local', 'bin')
]

/**
 * Signs in by running the user's own `aws sso login`.
 *
 * Preferred over doing the device-code dance ourselves for one reason that matters to
 * the person approving it: the browser then asks whether to authorise the **AWS CLI**,
 * the client they already know and their administrator has already allowed — not some
 * unfamiliar application called Bucketeer. It is their role and their session; this is
 * the same command they would type, run for them.
 *
 * Falls back to the built-in flow when no CLI is installed. See {@link SsoLoginChain}.
 */
export class AwsCliSsoAuthenticator implements SsoAuthenticator {
  constructor(private readonly profiles: ProfileDirectory) {}

  /** The `aws` executable, or null when there is none to run. */
  async locate(): Promise<string | null> {
    const directories = [
      ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
      ...EXTRA_DIRECTORIES
    ]
    const name = process.platform === 'win32' ? 'aws.exe' : 'aws'

    for (const directory of directories) {
      const candidate = join(directory, name)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        continue
      }
    }
    return null
  }

  async login(
    profileName: string,
    onPending: (pending: SsoPending) => void
  ): Promise<SsoLoginResult> {
    const executable = await this.locate()
    if (!executable) throw new BucketeerError('The AWS CLI is not installed.', 'AwsCliMissing')

    const settings = await this.profiles.readSsoSettings(profileName)
    if (!settings) {
      throw new BucketeerError(
        `Profile "${profileName}" is not configured for IAM Identity Center, so there is nothing to sign in to.`,
        'NotAnSsoProfile'
      )
    }

    // The CLI opens the browser itself and prints the code it expects to see there.
    // Both are echoed to the UI as they appear, so the window shows the same thing the
    // terminal would — a login that opened a tab behind the app is otherwise a mystery.
    await this.run(executable, profileName, (line) => {
      const code = /enter the code:?\s*([A-Z0-9][A-Z0-9-]{3,})/i.exec(line)?.[1]
      const uri = /https?:\/\/\S+/.exec(line)?.[0]
      if (code || uri) {
        onPending({ profileName, userCode: code ?? '', verificationUri: uri ?? settings.startUrl })
      }
    })

    // The CLI wrote the token to the shared cache; read back when it actually expires
    // rather than guessing, since that figure is shown to the user.
    const token = await readCachedToken(settings)
    return { profileName, expiresAt: token?.expiresAt ?? new Date().toISOString() }
  }

  private run(
    executable: string,
    profileName: string,
    onLine: (line: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ['sso', 'login', '--profile', profileName], {
        // No shell: the profile name goes straight to the process, never through a
        // command line something else could interpret.
        shell: false,
        env: { ...process.env, AWS_PAGER: '' }
      })

      let output = ''
      const consume = (chunk: Buffer): void => {
        const text = chunk.toString()
        output += text
        for (const line of text.split('\n')) onLine(line)
      }
      child.stdout.on('data', consume)
      child.stderr.on('data', consume)

      const timer = setTimeout(() => {
        child.kill()
        reject(
          new BucketeerError(
            'Timed out waiting for the sign-in to be approved in the browser.',
            'SsoLoginTimeout'
          )
        )
      }, LOGIN_TIMEOUT_MS)

      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve()
          return
        }
        // The CLI's own diagnosis beats anything invented here.
        reject(
          new BucketeerError(
            output.trim() || `aws sso login exited with code ${code}.`,
            'SsoLoginFailed'
          )
        )
      })
    })
  }
}

/**
 * Tries each authenticator in turn, using the first one able to run.
 *
 * Keeps the choice of *how* to sign in out of the service that asks for a sign-in, so
 * adding another mechanism later changes only the list this is built with.
 */
export class SsoLoginChain implements SsoAuthenticator {
  constructor(
    private readonly primary: AwsCliSsoAuthenticator,
    private readonly fallback: SsoAuthenticator
  ) {}

  async login(
    profileName: string,
    onPending: (pending: SsoPending) => void
  ): Promise<SsoLoginResult> {
    // Only the CLI's absence falls through. A login the user started and abandoned must
    // not silently begin again under a different client.
    if (await this.primary.locate()) return this.primary.login(profileName, onPending)
    return this.fallback.login(profileName, onPending)
  }
}
