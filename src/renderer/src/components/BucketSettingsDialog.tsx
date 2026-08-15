import { useCallback, useEffect, useState } from 'react'
import type { BucketSettings } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { useSession } from '../store/session'
import { Button, Tag } from './primitives'

/**
 * The bucket-level settings that decide whether anything you do here is allowed.
 *
 * Read-only by default, with the policy editable behind a deliberate step. Most of the
 * value is in simply seeing these: a denied upload is usually explained by the policy or
 * the encryption rule, and finding that out currently means opening the AWS console.
 */
type Tab = 'overview' | 'policy' | 'lifecycle' | 'access'

export function BucketSettingsDialog({ bucket, onClose }: { bucket: string; onClose: () => void }) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const [tab, setTab] = useState<Tab>('overview')

  const [settings, setSettings] = useState<BucketSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!connectionId) return
    setError(null)
    try {
      const found = await api.buckets.settings(connectionId, bucket)
      setSettings(found)
      setDraft(pretty(found.policy))
    } catch (failure) {
      setError(messageFor(failure))
    }
  }, [connectionId, bucket])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editing])

  async function savePolicy() {
    if (!connectionId) return
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      await api.buckets.setPolicy(connectionId, bucket, draft.trim() ? draft : null)
      setSaved('Policy saved.')
      setEditing(false)
      await load()
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  async function toggleVersioning(enabled: boolean) {
    if (!connectionId) return
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      await api.buckets.setVersioning(connectionId, bucket, enabled)
      setSaved(enabled ? 'Versioning enabled.' : 'Versioning suspended.')
      await load()
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-14 backdrop-blur-[2px]"
      onClick={() => (editing ? undefined : onClose())}
    >
      <div
        role="dialog"
        aria-label={`Settings for ${bucket}`}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[82vh] w-[640px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
      >
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="eyebrow">Bucket settings</span>
          <button onClick={onClose} className="text-faint hover:text-text" aria-label="Close">
            ✕
          </button>
        </header>

        <p className="tabular border-b border-line-soft px-4 py-2.5 text-[12px] break-all text-text">
          {bucket}
        </p>

        <nav className="flex shrink-0 gap-1 border-b border-line-soft px-3 py-1.5">
          {(['overview', 'policy', 'lifecycle', 'access'] as Tab[]).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] capitalize transition-colors ${
                tab === value ? 'bg-raised text-text shadow-sm' : 'text-muted hover:text-text'
              }`}
            >
              {value}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!settings && !error ? <p className="text-[12px] text-faint">Loading…</p> : null}

          {settings ? (
            <div className="flex flex-col gap-5">
              {tab === 'overview' ? (
                <>
              <Section
                title="Encryption"
                denied={settings.encryptionDenied}
                deniedNote="Not readable with these credentials. Uploads still work: the key is taken from an existing object instead."
              >
                {settings.encryption ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Tag tone="success">{settings.encryption.sseAlgorithm}</Tag>
                      <span className="text-[11.5px] text-muted">applied to every new object</span>
                    </div>
                    {settings.encryption.kmsKeyId ? (
                      <p className="tabular text-[11px] break-all text-faint">
                        {settings.encryption.kmsKeyId}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-muted">No default encryption configured.</p>
                )}
              </Section>

              <Section
                title="Versioning"
                denied={settings.versioningDenied}
                deniedNote="Not readable with these credentials."
              >
                <div className="flex items-center gap-3">
                  <Tag tone={settings.versioning === 'Enabled' ? 'success' : 'neutral'}>
                    {settings.versioning}
                  </Tag>
                  {!settings.versioningDenied ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void toggleVersioning(settings.versioning !== 'Enabled')}
                    >
                      {settings.versioning === 'Enabled' ? 'Suspend' : 'Enable'}
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                  With versioning on, deleting an object only hides it and previous copies are
                  kept — both visible in an object's Versions tab. Suspending keeps everything
                  already stored.
                </p>
              </Section>

              <Section
                title="Public access"
                denied={settings.publicAccessDenied}
                deniedNote="Not readable with these credentials."
              >
                {settings.publicAccess ? (
                  <ul className="flex flex-col gap-1">
                    <Toggle label="Block public ACLs" on={settings.publicAccess.blockPublicAcls} />
                    <Toggle label="Ignore public ACLs" on={settings.publicAccess.ignorePublicAcls} />
                    <Toggle
                      label="Block public policies"
                      on={settings.publicAccess.blockPublicPolicy}
                    />
                    <Toggle
                      label="Restrict public buckets"
                      on={settings.publicAccess.restrictPublicBuckets}
                    />
                  </ul>
                ) : (
                  <p className="text-[11.5px] text-muted">
                    No public access block set, so a policy could make this bucket public.
                  </p>
                )}
              </Section>

                </>
              ) : null}

              {tab === 'policy' ? (
              <Section
                title="Bucket policy"
                denied={settings.policyDenied}
                deniedNote="Not readable with these credentials. This is the most common reason an upload or download is refused, so it is worth asking an administrator for s3:GetBucketPolicy."
              >
                {settings.policy || editing ? (
                  <>
                    <textarea
                      value={draft}
                      readOnly={!editing}
                      onChange={(event) => setDraft(event.target.value)}
                      spellCheck={false}
                      rows={14}
                      className="tabular w-full rounded-md border border-line bg-sunken px-2.5 py-2 text-[11px] leading-relaxed text-text focus:border-accent focus:outline-none"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      {editing ? (
                        <>
                          <Button variant="primary" onClick={() => void savePolicy()} disabled={busy}>
                            {busy ? 'Saving…' : 'Save policy'}
                          </Button>
                          <Button
                            onClick={() => {
                              setEditing(false)
                              setDraft(pretty(settings.policy))
                            }}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                          <span className="text-[11px] leading-snug text-danger">
                            A wrong policy can lock everyone out of this bucket, including you.
                          </span>
                        </>
                      ) : (
                        <Button variant="secondary" onClick={() => setEditing(true)}>
                          Edit policy
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-[11.5px] text-muted">
                    No bucket policy. Access is decided by IAM alone.
                  </p>
                )}
              </Section>
              ) : null}

              {tab === 'lifecycle' ? <Lifecycle settings={settings} /> : null}
              {tab === 'access' ? <AccessSettings settings={settings} /> : null}
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-md border border-danger/35 bg-danger-soft/50 px-3 py-2 text-[11.5px] leading-relaxed text-text">
              {error}
            </p>
          ) : null}

          {saved ? (
            <p className="mt-4 rounded-md border border-success/35 bg-success-soft/50 px-3 py-2 text-[11.5px] text-text">
              {saved}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * Lifecycle rules, read-only.
 *
 * These are why objects vanish or change class without anyone touching them, so seeing
 * them explains more than editing them would. Editing is deliberately not offered yet: a
 * mistaken rule deletes data on a schedule, silently, days later.
 */
function Lifecycle({ settings }: { settings: BucketSettings }) {
  if (settings.lifecycleDenied) {
    return (
      <Section title="Lifecycle" denied deniedNote="Not readable with these credentials.">
        <span />
      </Section>
    )
  }

  if (!settings.lifecycle || settings.lifecycle.length === 0) {
    return (
      <Section title="Lifecycle" denied={false} deniedNote="">
        <p className="text-[11.5px] leading-relaxed text-muted">
          No lifecycle rules. Objects stay in their current storage class until something
          moves them.
        </p>
      </Section>
    )
  }

  return (
    <Section title="Lifecycle" denied={false} deniedNote="">
      <ul className="flex flex-col gap-2">
        {settings.lifecycle.map((rule) => (
          <li key={rule.id} className="rounded-md border border-line bg-sunken px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="tabular text-[12px] text-text">{rule.id}</span>
              <Tag tone={rule.status === 'Enabled' ? 'success' : 'neutral'}>{rule.status}</Tag>
            </div>
            <p className="tabular mt-1 text-[11px] text-faint">
              {rule.prefix ? `applies to ${rule.prefix}` : 'applies to the whole bucket'}
            </p>
            <ul className="mt-1.5 flex flex-col gap-0.5 text-[11.5px] text-muted">
              {rule.transitions.map((transition, index) => (
                <li key={index}>
                  after {transition.days ?? '?'} days → {transition.storageClass.toLowerCase()}
                </li>
              ))}
              {rule.expirationDays !== undefined ? (
                <li className="text-danger">deleted after {rule.expirationDays} days</li>
              ) : null}
              {rule.noncurrentExpirationDays !== undefined ? (
                <li>old versions deleted after {rule.noncurrentExpirationDays} days</li>
              ) : null}
              {rule.abortIncompleteAfterDays !== undefined ? (
                <li>interrupted uploads cleaned up after {rule.abortIncompleteAfterDays} days</li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** CORS, logging, website hosting and requester pays: everything about reaching the bucket. */
function AccessSettings({ settings }: { settings: BucketSettings }) {
  return (
    <div className="flex flex-col gap-5">
      <Section
        title="CORS"
        denied={settings.corsDenied}
        deniedNote="Not readable with these credentials."
      >
        {settings.cors && settings.cors.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {settings.cors.map((rule, index) => (
              <li key={index} className="rounded-md border border-line bg-sunken px-3 py-2">
                <p className="tabular text-[11.5px] break-all text-text">
                  {rule.allowedOrigins.join(', ')}
                </p>
                <p className="tabular mt-0.5 text-[11px] text-faint">
                  {rule.allowedMethods.join(' ')}
                  {rule.maxAgeSeconds ? ` · cached ${rule.maxAgeSeconds}s` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] leading-relaxed text-muted">
            No CORS rules, so browser JavaScript on another origin cannot read from this
            bucket.
          </p>
        )}
      </Section>

      <Section
        title="Static website"
        denied={settings.websiteDenied}
        deniedNote="Not readable with these credentials."
      >
        {settings.website ? (
          <p className="tabular text-[11.5px] text-muted">
            index: {settings.website.indexDocument ?? '—'}
            {settings.website.errorDocument ? ` · error: ${settings.website.errorDocument}` : ''}
          </p>
        ) : (
          <p className="text-[11.5px] text-muted">Not configured as a website.</p>
        )}
      </Section>

      <Section
        title="Access logging"
        denied={settings.loggingDenied}
        deniedNote="Not readable with these credentials."
      >
        {settings.logging ? (
          <p className="tabular text-[11.5px] break-all text-muted">
            → {settings.logging.targetBucket}/{settings.logging.targetPrefix}
          </p>
        ) : (
          <p className="text-[11.5px] text-muted">
            Off. Requests to this bucket are not recorded anywhere.
          </p>
        )}
      </Section>

      <Section
        title="Requester pays"
        denied={settings.requesterPaysDenied}
        deniedNote="Not readable with these credentials."
      >
        <div className="flex items-center gap-2">
          <Tag tone={settings.requesterPays ? 'accent' : 'neutral'}>
            {settings.requesterPays ? 'on' : 'off'}
          </Tag>
          <span className="text-[11.5px] text-muted">
            {settings.requesterPays
              ? 'Downloads are billed to whoever makes the request.'
              : 'The bucket owner pays for downloads.'}
          </span>
        </div>
      </Section>
    </div>
  )
}

function Section({
  title,
  denied,
  deniedNote,
  children
}: {
  title: string
  denied: boolean
  deniedNote: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="eyebrow">{title}</span>
        {/* "Not allowed to look" and "not configured" lead to opposite conclusions when
            someone is working out why they were denied, so they never look alike here. */}
        {denied ? <Tag>no permission</Tag> : null}
      </div>
      {denied ? (
        <p className="text-[11.5px] leading-relaxed text-faint">{deniedNote}</p>
      ) : (
        children
      )}
    </section>
  )
}

function Toggle({ label, on }: { label: string; on: boolean }) {
  return (
    <li className="flex items-center gap-2 text-[11.5px]">
      <span className={on ? 'text-success' : 'text-faint'} aria-hidden>
        {on ? '●' : '○'}
      </span>
      <span className="text-muted">{label}</span>
      <span className="tabular text-[10px] tracking-wide text-faint uppercase">
        {on ? 'blocked' : 'allowed'}
      </span>
    </li>
  )
}

/** Policies arrive as one long line; nobody can read that. */
function pretty(policy: string | null): string {
  if (!policy) return ''
  try {
    return JSON.stringify(JSON.parse(policy), null, 2)
  } catch {
    return policy
  }
}
