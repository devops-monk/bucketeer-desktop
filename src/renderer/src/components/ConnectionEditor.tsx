import { useEffect, useState } from 'react'
import type { ConnectionSummary, CredentialKind, CredentialSource } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { useSession } from '../store/session'
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
  const [kind, setKind] = useState<CredentialKind>(connection?.credentials.kind ?? 'shared-profile')

  const [profileName, setProfileName] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  const [roleArn, setRoleArn] = useState('')
  const [mfaSerial, setMfaSerial] = useState('')
  const [externalId, setExternalId] = useState('')
  const [baseProfile, setBaseProfile] = useState('')

  const [profiles, setProfiles] = useState<string[]>([])
  const [secretsAvailable, setSecretsAvailable] = useState(true)
  const [busy, setBusy] = useState(false)
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
        setProfileName((current) => current || (found[0] ?? ''))
        setBaseProfile((current) => current || (found[0] ?? ''))
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
    setBusy(true)
    setError(null)
    setTested(null)
    try {
      const saved = await api.connections.save({
        id: connection?.id,
        name: name.trim() || 'Untitled connection',
        region,
        endpoint: endpoint.trim() || undefined,
        forcePathStyle: Boolean(endpoint.trim()),
        kmsKeyId: kmsKeyId.trim() || undefined,
        credentials: buildCredentials()
      })
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
      setBusy(false)
    }
  }

  async function remove() {
    if (!connection) return
    setBusy(true)
    try {
      await api.connections.remove(connection.id)
      await loadConnections()
      onClose()
    } catch (failure) {
      setError(messageFor(failure))
      setBusy(false)
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
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production data lake"
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Region">
                <Select value={region} onChange={(event) => setRegion(event.target.value)}>
                  {REGIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Credentials">
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
                hint="Profiles from ~/.aws/config and ~/.aws/credentials, including SSO and credential_process."
              >
                {profiles.length > 0 ? (
                  <Select
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                  >
                    {profiles.map((value) => (
                      <option key={value} value={value}>
                        {value}
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
                <Field label="Role ARN">
                  <Input
                    value={roleArn}
                    onChange={(event) => setRoleArn(event.target.value)}
                    placeholder="arn:aws:iam::123456789012:role/DataReader"
                    className="tabular"
                  />
                </Field>
                <Field label="Assume it using" hint="The credentials that call sts:AssumeRole.">
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
                  <Field label="MFA device" hint="Required only if the trust policy demands MFA.">
                    <Input
                      value={mfaSerial}
                      onChange={(event) => setMfaSerial(event.target.value)}
                      placeholder="arn:aws:iam::…:mfa/you"
                      className="tabular"
                    />
                  </Field>
                  <Field label="External ID" hint="For cross-account roles that require one.">
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
                hint="For MinIO, Cloudflare R2, Wasabi, or Backblaze. Leave empty for AWS."
              >
                <Input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://minio.internal:9000"
                  className="tabular"
                />
              </Field>
              <Field label="KMS key for uploads" hint="Key id, ARN, or alias. Optional.">
                <Input
                  value={kmsKeyId}
                  onChange={(event) => setKmsKeyId(event.target.value)}
                  placeholder="alias/data-lake"
                  className="tabular"
                />
              </Field>
            </div>

            {!secretsAvailable && needsSecrets ? (
              <p className="rounded-[3px] border border-danger/40 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-text">
                This system has no keychain available, so access keys cannot be saved. Use an
                AWS profile or the default credential chain instead.
              </p>
            ) : null}

            {error ? (
              <p className="rounded-[3px] border border-danger/40 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-text">
                {error}
              </p>
            ) : null}

            {tested ? (
              <p className="rounded-[3px] border border-success/40 bg-success/5 px-3 py-2 text-[11.5px] leading-relaxed text-text">
                {tested}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          {connection ? (
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              Delete
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button onClick={() => void save(true)} disabled={busy}>
            Test connection
          </Button>
          <Button variant="primary" onClick={() => void save(false)} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
