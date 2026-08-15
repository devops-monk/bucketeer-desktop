import { useEffect, useState } from 'react'
import type { SsoPending } from '@shared/types'
import { api, messageFor } from '../lib/api'
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
  variant = 'ghost'
}: {
  profileName: string
  onSignedIn?: () => void
  variant?: 'primary' | 'ghost'
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
      <Button variant={variant} onClick={() => void signIn()} disabled={busy || !profileName}>
        {busy ? 'Waiting for approval…' : 'Sign in with SSO'}
      </Button>

      {busy && pending ? (
        <div className="rounded-[3px] border border-line bg-ink px-3 py-2">
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
