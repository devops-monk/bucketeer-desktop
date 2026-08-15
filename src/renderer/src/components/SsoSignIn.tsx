import { useEffect, useState } from 'react'
import type { SsoPending } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { KeyIcon } from './icons'
import { Button } from './primitives'

/**
 * Signs a profile in to IAM Identity Center without leaving the app.
 *
 * The browser is opened automatically, but the code and URL are shown as well: the
 * browser can open behind the window, or not at all, and a login you cannot see is
 * indistinguishable from one that is broken.
 */
export function SsoSignIn({
  profileName,
  onSignedIn,
  variant = 'secondary'
}: {
  profileName: string
  onSignedIn?: () => void
  variant?: 'primary' | 'secondary'
}) {
  const [pending, setPending] = useState<SsoPending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signedInAt, setSignedInAt] = useState<string | null>(null)

  useEffect(() => api.credentials.onSsoPending(setPending), [])

  async function signIn() {
    setBusy(true)
    setError(null)
    setSignedInAt(null)
    try {
      const result = await api.credentials.ssoLogin(profileName)
      setSignedInAt(result.expiresAt)
      onSignedIn?.()
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={variant}
        onClick={() => void signIn()}
        disabled={busy || !profileName}
        className="h-8 w-full justify-start px-3"
      >
        {busy ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
        ) : (
          <KeyIcon className="h-3.5 w-3.5" />
        )}
        <span className="flex-1 text-left">
          {busy ? 'Waiting for approval in your browser…' : `Sign in to ${profileName}`}
        </span>
      </Button>

      {!busy && !signedInAt ? (
        <p className="text-[11px] leading-relaxed text-faint">
          Runs <span className="tabular">aws sso login --profile {profileName || '…'}</span> when
          the AWS CLI is installed, so the browser asks you to authorise the AWS CLI and your
          terminal is signed in too. A session you started in a terminal already counts — this
          is only needed when there isn’t one.
        </p>
      ) : null}

      {busy && pending ? (
        <div className="rounded-md border border-line bg-sunken px-3 py-2.5">
          <p className="text-[11.5px] leading-relaxed text-muted">
            Approve the sign-in in your browser. Confirm this code matches:
          </p>
          <p className="tabular mt-1 text-[15px] tracking-[0.2em] text-accent-ink">
            {pending.userCode}
          </p>
          <p className="mt-1 text-[11px] break-all text-faint">{pending.verificationUri}</p>
        </div>
      ) : null}

      {signedInAt ? (
        <p className="text-[11.5px] leading-relaxed text-success">
          Signed in. Session valid until {new Date(signedInAt).toLocaleString()}.
        </p>
      ) : null}

      {error ? <p className="text-[11.5px] leading-relaxed text-danger">{error}</p> : null}
    </div>
  )
}
