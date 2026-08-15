import { useEffect, useState } from 'react'
import type { ConnectionSummary, CredentialKind, CredentialSource } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { useSession } from '../store/session'
import { KmsKeyPicker } from './KmsKeyPicker'
import { SsoSignIn } from './SsoSignIn'
import { Button, Field, Input, Select } from './primitives'

/**
 * Create or edit a connection.
 *
 * Editing an existing connection never loads its secrets back into the renderer — the
 * main process holds them and the renderer only ever had a label. So editing a
 * key-based connection asks for the key again, and the form says why.
 */

const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'ca-central-1', 'sa-east-1'
]

const CREDENTIAL_LABELS: Record<CredentialKind, string> = {
  'shared-profile': 'AWS profile',
  'access-key': 'Access key',
  'assume-role': 'Assume a role',
  environment: 'Environment variables',
  'default-chain': 'Default credential chain'
}

interface Props {
  connection: ConnectionSummary | null
  onClose: () => void
}

export function ConnectionEditor({ connection, onClose }: Props) {
  const loadConnections = useSession((state) => state.loadConnections)

  const [name, setName] = useState(connection?.name ?? '')
  const [region, setRegion] = useState(connection?.region ?? 'us-east-1')
  const [endpoint, setEndpoint] = useState(connection?.endpoint ?? '')
  const [kmsKeyId, setKmsKeyId] = useState(connection?.kmsKeyId ?? '')
  const [acceleration, setAcceleration] = useState(connection?.transferAcceleration ?? false)
  const [kind, setKind] = useState<CredentialKind>(connection?.credentials.kind ?? 'shared-profile')

  // Seeded from what was saved. Secrets are absent by design, so a key-based
  // connection starts blank and the form says why.
  const [profileName, setProfileName] = useState(connection?.credentials.profileName ?? '')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  const [roleArn, setRoleArn] = useState(connection?.credentials.roleArn ?? '')
  const [mfaSerial, setMfaSerial] = useState(connection?.credentials.mfaSerial ?? '')
  const [externalId, setExternalId] = useState(connection?.credentials.externalId ?? '')
  const [baseProfile, setBaseProfile] = useState(connection?.credentials.baseProfileName ?? '')

  // The id of the record this dialog owns. Starts as the connection being edited, and
  // is filled in the moment a new connection is first saved — otherwise pressing Test
  // and then Save would create the same connection twice.
  const [savedId, setSavedId] = useState<string | null>(connection?.id ?? null)
  const [keyPickerOpen, setKeyPickerOpen] = useState(false)
  const [profiles, setProfiles] = useState<string[]>([])
  const [secretsAvailable, setSecretsAvailable] = useState(true)
  const [busyAction, setBusyAction] = useState<'save' | 'test' | 'delete' | null>(null)
  const busy = busyAction !== null
  const [error, setError] = useState<string | null>(null)
  const [tested, setTested] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [found, available] = await Promise.all([
          api.credentials.sharedProfiles(),
          api.connections.secretsAvailable()
        ])
        setProfiles(found)
        setSecretsAvailable(available)
        // Never overwrite a saved selection: defaulting to the first profile is only
        // right for a brand new connection.
        setProfileName((current) => current || (found[0] ?? ''))
        if (!connection) setBaseProfile((current) => current || (found[0] ?? ''))
      } catch (failure) {
        setError(messageFor(failure))
      }
    })()
  }, [])

  // Esc closes the dialog, as it does everywhere else on the desktop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function buildCredentials(): CredentialSource {
    switch (kind) {
      case 'access-key':
        return {
          kind: 'access-key',
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
          sessionToken: sessionToken.trim() || undefined
        }
      case 'shared-profile':
        return { kind: 'shared-profile', profileName: profileName.trim() }
      case 'assume-role':
        return {
          kind: 'assume-role',
          roleArn: roleArn.trim(),
          base: baseProfile
            ? { kind: 'shared-profile', profileName: baseProfile }
            : { kind: 'default-chain' },
          mfaSerial: mfaSerial.trim() || undefined,
          externalId: externalId.trim() || undefined
        }
      case 'environment':
        return { kind: 'environment' }
      case 'default-chain':
        return { kind: 'default-chain' }
    }
  }

  async function save(thenTest: boolean) {
    setBusyAction(thenTest ? 'test' : 'save')
    setError(null)
    setTested(null)
    try {
      const saved = await api.connections.save({
        id: savedId ?? undefined,
        name: name.trim() || 'Untitled connection',
        region,
        endpoint: endpoint.trim() || undefined,
        forcePathStyle: Boolean(endpoint.trim()),
        kmsKeyId: kmsKeyId.trim() || undefined,
        transferAcceleration: acceleration,
        credentials: buildCredentials()
      })
      setSavedId(saved.id)
      await loadConnections()

      if (thenTest) {
        const result = await api.connections.test(saved.id)
        setTested(
          `Connected${result.accountId ? ` to account ${result.accountId}` : ''} · ${result.buckets} ${
            result.buckets === 1 ? 'bucket' : 'buckets'
          } visible`
        )
      } else {
        onClose()
      }
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusyAction(null)
    }
  }

  async function remove() {
    if (!savedId) return
    setBusyAction('delete')
    try {
      await api.connections.remove(savedId)
      await loadConnections()
      onClose()
    } catch (failure) {
      setError(messageFor(failure))
      setBusyAction(null)
    }
  }

  const needsSecrets = kind === 'access-key'
  const editingKeys = connection !== null && needsSecrets

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-16 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={connection ? 'Edit connection' : 'Add a connection'}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-[520px] flex-col overflow-hidden rounded-[4px] border border-line bg-panel shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="eyebrow">{connection ? 'Edit connection' : 'New connection'}</span>
          <button onClick={onClose} className="text-faint hover:text-text" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-4">
            <Field label="Name" tooltip="Whatever you want to call this in the sidebar. It is not sent to AWS.">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production data lake"
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Region"
                tooltip="Where requests are sent first. Buckets in other regions still open — Bucketeer follows S3's redirect."
              >
                <Select value={region} onChange={(event) => setRegion(event.target.value)}>
                  {REGIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Credentials"
                tooltip="How Bucketeer authenticates. Profiles cover SSO and credential_process; keys are stored in your system keychain."
              >
                <Select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as CredentialKind)}
                >
                  {Object.entries(CREDENTIAL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {kind === 'shared-profile' ? (
              <Field
                label="Profile"
                tooltip="Read from ~/.aws/config and ~/.aws/credentials. Expired SSO profiles are still listed so you can sign in to them."
                hint="Includes SSO and credential_process profiles."
              >
                {profiles.length > 0 ? (
                  <Select
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                  >
                    {/* A saved profile that no longer exists in the config must still
                        show, or the form would silently switch it to another account. */}
                    {(profiles.includes(profileName) || !profileName
                      ? profiles
                      : [profileName, ...profiles]
                    ).map((value) => (
                      <option key={value} value={value}>
                        {value}
                        {profiles.includes(value) ? '' : ' (not in ~/.aws/config)'}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="default"
                  />
                )}
              </Field>
            ) : null}

            {kind === 'shared-profile' && profileName ? (
              <SsoSignIn profileName={profileName} onSignedIn={() => setError(null)} />
            ) : null}

            {kind === 'access-key' ? (
              <>
                {editingKeys ? (
                  <p className="rounded-[3px] border border-line bg-ink px-3 py-2 text-[11.5px] leading-relaxed text-muted">
                    Saved keys stay in the system keychain and are never sent back to this
                    window. Enter the key again to change it.
                  </p>
                ) : null}
                <Field label="Access key ID">
                  <Input
                    value={accessKeyId}
                    onChange={(event) => setAccessKeyId(event.target.value)}
                    placeholder="AKIA…"
                    className="tabular"
                  />
                </Field>
                <Field label="Secret access key">
                  <Input
                    type="password"
                    value={secretAccessKey}
                    onChange={(event) => setSecretAccessKey(event.target.value)}
                    className="tabular"
                  />
                </Field>
                <Field label="Session token" hint="Only for temporary credentials.">
                  <Input
                    type="password"
                    value={sessionToken}
                    onChange={(event) => setSessionToken(event.target.value)}
                    className="tabular"
                  />
                </Field>
              </>
            ) : null}

            {kind === 'assume-role' ? (
              <>
                <Field
                  label="Role ARN"
                  tooltip="The role to assume, e.g. arn:aws:iam::123456789012:role/DataReader."
                >
                  <Input
                    value={roleArn}
                    onChange={(event) => setRoleArn(event.target.value)}
                    placeholder="arn:aws:iam::123456789012:role/DataReader"
                    className="tabular"
                  />
                </Field>
                <Field
                  label="Assume it using"
                  tooltip="The credentials that call sts:AssumeRole. They need permission to assume the role above."
                >
                  <Select value={baseProfile} onChange={(event) => setBaseProfile(event.target.value)}>
                    <option value="">Default credential chain</option>
                    {profiles.map((value) => (
                      <option key={value} value={value}>
                        Profile {value}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="MFA device"
                    tooltip="The ARN or serial of your MFA device. Only needed when the role's trust policy demands MFA."
                  >
                    <Input
                      value={mfaSerial}
                      onChange={(event) => setMfaSerial(event.target.value)}
                      placeholder="arn:aws:iam::…:mfa/you"
                      className="tabular"
                    />
                  </Field>
                  <Field
                    label="External ID"
                    tooltip="A shared secret some cross-account roles require in their trust policy."
                  >
                    <Input
                      value={externalId}
                      onChange={(event) => setExternalId(event.target.value)}
                      className="tabular"
                    />
                  </Field>
                </div>
              </>
            ) : null}

            {kind === 'environment' || kind === 'default-chain' ? (
              <p className="rounded-[3px] border border-line bg-ink px-3 py-2 text-[11.5px] leading-relaxed text-muted">
                {kind === 'environment'
                  ? 'Reads AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN from the environment Bucketeer was launched in.'
                  : 'Tries environment variables, then the shared config files, then container and instance roles — the same order the AWS CLI uses.'}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 border-t border-line-soft pt-4">
              <Field
                label="Endpoint"
                tooltip="Point at S3-compatible storage instead of AWS. Setting this also switches on path-style addressing, which those services need."
                hint="MinIO, Cloudflare R2, Wasabi, Backblaze. Empty for AWS."
              >
                <Input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://minio.internal:9000"
                  className="tabular"
                />
              </Field>
              <Field
                label="Default KMS key for uploads"
                tooltip="Encrypts every upload on this connection with one key. Use the full ARN — bucket policies are written against ARNs and will not match an alias."
                hint={
                  savedId
                    ? 'Optional. Left empty, Bucketeer uses whatever key the bucket itself uses.'
                    : 'Optional. Save the connection first to browse its keys.'
                }
              >
                <div className="flex gap-1.5">
                  <Input
                    value={kmsKeyId}
                    onChange={(event) => setKmsKeyId(event.target.value)}
                    placeholder="arn:aws:kms:eu-west-1:…:key/…"
                    className="tabular flex-1"
                  />
                  <Button onClick={() => setKeyPickerOpen(true)} disabled={!savedId}>
                    Browse
                  </Button>
                </div>
              </Field>
            </div>

            {!endpoint.trim() ? (
              <label className="flex items-start gap-2.5 rounded-md border border-line bg-sunken px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={acceleration}
                  onChange={(event) => setAcceleration(event.target.checked)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="block text-[12px] text-text">Use S3 Transfer Acceleration</span>
                  <span className="block text-[11px] leading-relaxed text-muted">
                    Routes transfers through the nearest AWS edge location, which is worth real
                    speed over long distances. It costs more per gigabyte, and only works on
                    buckets that have it switched on — requests fail if they do not.
                  </span>
                </span>
              </label>
            ) : null}

            {!secretsAvailable && needsSecrets ? (
              <p className="rounded-[3px] border border-danger/40 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-text">
                This system has no keychain available, so access keys cannot be saved. Use an
                AWS profile or the default credential chain instead.
              </p>
            ) : null}

          </div>
        </div>

        {/* Outcomes sit outside the scrolling body: the previous version rendered them
            at the end of the form, where a result could land below the fold and read as
            nothing having happened. */}
        {busyAction === 'test' || tested || error ? (
          <div
            className={`flex shrink-0 items-start gap-2 border-t px-4 py-2.5 ${
              error
                ? 'border-danger/30 bg-danger-soft/50'
                : tested
                  ? 'border-success/30 bg-success-soft/50'
                  : 'border-line bg-sunken'
            }`}
          >
            <span className="mt-px shrink-0" aria-hidden>
              {busyAction === 'test' ? (
                <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
              ) : error ? (
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-danger">
                  <circle cx="8" cy="8" r="6.25" />
                  <path d="M8 4.75v4M8 11.1v.05" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-success">
                  <circle cx="8" cy="8" r="6.25" />
                  <path d="M5.2 8.2 7 10l3.8-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <p className="flex-1 text-[11.5px] leading-relaxed whitespace-pre-line text-text">
              {busyAction === 'test'
                ? 'Resolving credentials and listing buckets…'
                : (error ?? tested)}
            </p>
          </div>
        ) : null}

        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          {savedId ? (
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              {busyAction === 'delete' ? 'Deleting…' : 'Delete'}
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button variant="secondary" onClick={() => void save(true)} disabled={busy}>
            {busyAction === 'test' ? 'Testing…' : 'Test connection'}
          </Button>
          <Button variant="primary" onClick={() => void save(false)} disabled={busy}>
            {busyAction === 'save' ? 'Saving…' : 'Save'}
          </Button>
        </footer>
      </div>

      {keyPickerOpen && savedId ? (
        <KmsKeyPicker
          connectionId={savedId}
          onSelect={(keyArn) => {
            setKmsKeyId(keyArn)
            setKeyPickerOpen(false)
          }}
          onClose={() => setKeyPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}
