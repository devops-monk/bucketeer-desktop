import { useEffect, useState } from 'react'
import type { Preferences } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { Button, Field, Input } from './primitives'

/**
 * Settings that apply to every connection: how hard to push the network, and how to get
 * out of it.
 *
 * Each one states what it trades away rather than just what it does — a bigger part size
 * is not simply "better", and a bandwidth cap costs speed on purpose.
 */
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.app
      .getPreferences()
      .then(setPreferences)
      .catch((failure: unknown) => setError(messageFor(failure)))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    if (!preferences) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api.app.setPreferences(preferences)
      setSaved(true)
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  function update(patch: Partial<Preferences>) {
    setPreferences((current) => (current ? { ...current, ...patch } : current))
    setSaved(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-20 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Preferences"
        onClick={(event) => event.stopPropagation()}
        className="flex w-[540px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
      >
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="eyebrow">Preferences</span>
          <button onClick={onClose} className="text-faint hover:text-text" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="flex flex-col gap-4 px-4 py-4">
          {!preferences ? (
            <p className="text-[12px] text-faint">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Files at once"
                  tooltip="How many transfers run in parallel. More is faster up to a point, then the connection becomes the limit and everything slows together."
                  hint="1 to 16"
                >
                  <Input
                    type="number"
                    min={1}
                    max={16}
                    value={preferences.concurrency}
                    onChange={(event) => update({ concurrency: Number(event.target.value) })}
                    className="tabular"
                  />
                </Field>

                <Field
                  label="Part size (MB)"
                  tooltip="Multipart chunk size. Larger parts mean fewer requests on a fast link; smaller ones mean a failed part is cheaper to retry on an unreliable one."
                  hint="5 to 512"
                >
                  <Input
                    type="number"
                    min={5}
                    max={512}
                    value={preferences.partSizeMb}
                    onChange={(event) => update({ partSizeMb: Number(event.target.value) })}
                    className="tabular"
                  />
                </Field>
              </div>

              <Field
                label="Bandwidth limit (MB/s)"
                tooltip="A ceiling shared by every transfer at once, not per file. Zero removes the limit."
                hint="0 for no limit. Useful when a large upload would otherwise take the office link down with it."
              >
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={preferences.bandwidthMbps}
                  onChange={(event) => update({ bandwidthMbps: Number(event.target.value) })}
                  className="tabular"
                />
              </Field>

              <Field
                label="Proxy"
                tooltip="Routes all AWS traffic through this proxy. Changing it reconnects every open connection."
                hint="Leave empty to connect directly."
              >
                <Input
                  value={preferences.proxyUrl}
                  onChange={(event) => update({ proxyUrl: event.target.value })}
                  placeholder="http://proxy.corp.example:3128"
                  className="tabular"
                />
              </Field>

              <p className="text-[11px] leading-relaxed text-faint">
                Changes apply to transfers started from now on. Anything already running keeps
                the settings it began with.
              </p>
            </>
          )}

          {error ? (
            <p className="rounded-md border border-danger/35 bg-danger-soft/50 px-3 py-2 text-[11.5px] text-text">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
          {saved ? <span className="flex-1 text-[11.5px] text-success">Saved.</span> : <div className="flex-1" />}
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !preferences}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
