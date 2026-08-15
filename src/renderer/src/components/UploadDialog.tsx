import { useEffect, useState } from 'react'
import type { BucketEncryption, UploadEncryption } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { useSession } from '../store/session'
import { Button, Input } from './primitives'

/**
 * Confirms an upload and its encryption.
 *
 * Encryption is asked about rather than assumed because buckets routinely carry a
 * policy denying any PutObject that is not encrypted with one specific KMS key, and
 * that denial arrives as a bare "explicit deny" that reads like a permissions problem.
 * The right key is preselected, so the common case is still one keystroke.
 */
export function UploadDialog({
  paths,
  onConfirm,
  onCancel
}: {
  /** Null when opened to change the setting rather than to confirm a specific upload. */
  paths: string[] | null
  onConfirm: (encryption: UploadEncryption) => void
  onCancel: () => void
}) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const connections = useSession((state) => state.connections)
  const location = useSession((state) => state.location)

  const connection = connections.find((candidate) => candidate.id === connectionId)
  const connectionKey = connection?.kmsKeyId

  const [bucketDefault, setBucketDefault] = useState<BucketEncryption | null>(null)
  const [loading, setLoading] = useState(true)
  const [choice, setChoice] = useState<'auto' | 'kms' | 'none'>('auto')
  const [customKey, setCustomKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!connectionId || !location) return
    let cancelled = false

    api.buckets
      .encryption(connectionId, location.bucket)
      .then((result) => {
        if (cancelled) return
        setBucketDefault(result)
        // Preselect the bucket's own key: it is the one its policy is most likely to
        // demand, and it is what the object would have been encrypted with anyway.
        if (!connectionKey && result?.kmsKeyId) setCustomKey(result.kmsKeyId)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(messageFor(failure))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, location, connectionKey])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const effectiveAutoKey = connectionKey ?? bucketDefault?.kmsKeyId
  const ready = choice !== 'kms' || customKey.trim().length > 0

  function confirm() {
    if (choice === 'kms') onConfirm({ mode: 'kms', kmsKeyId: customKey.trim() })
    else if (choice === 'none') onConfirm({ mode: 'none' })
    else onConfirm({ mode: 'auto' })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-24 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label="Upload"
        onClick={(event) => event.stopPropagation()}
        className="w-[520px] rounded-[4px] border border-line bg-panel p-4 shadow-2xl"
      >
        <p className="text-[13px] text-text">
          {paths
            ? `Upload ${paths.length} ${paths.length === 1 ? 'item' : 'items'}`
            : 'Encryption for uploads'}
        </p>
        <p className="tabular mt-1 text-[11.5px] break-all text-muted">
          s3://{location?.bucket}/{location?.prefix}
        </p>

        <div className="mt-4 flex flex-col gap-1.5">
          <span className="eyebrow">Encryption</span>

          <Option
            selected={choice === 'auto'}
            onSelect={() => setChoice('auto')}
            title={effectiveAutoKey ? 'Use the expected key' : 'No key found'}
            detail={
              loading
                ? 'Checking the bucket…'
                : effectiveAutoKey
                  ? `${connectionKey ? 'From this connection' : "The bucket's default key"} · ${effectiveAutoKey}`
                  : 'Neither this connection nor the bucket provided a key. Uploads will be sent without encryption headers, which buckets requiring SSE-KMS will reject.'
            }
          />

          <Option
            selected={choice === 'kms'}
            onSelect={() => setChoice('kms')}
            title="Use a specific KMS key"
            detail="Give the full key ARN. A policy written against an ARN will not match an alias or a bare key id."
          >
            <Input
              value={customKey}
              onChange={(event) => setCustomKey(event.target.value)}
              onFocus={() => setChoice('kms')}
              placeholder="arn:aws:kms:eu-west-1:123456789012:key/…"
              className="tabular mt-2"
            />
          </Option>

          <Option
            selected={choice === 'none'}
            onSelect={() => setChoice('none')}
            title="Send no encryption headers"
            detail="The bucket's own default encryption still applies server-side, but a policy that requires SSE-KMS on the request will deny the upload."
          />
        </div>

        {error ? <p className="mt-3 text-[11.5px] text-danger">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={!ready}>
            {paths ? 'Upload' : 'Use this'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Option({
  selected,
  onSelect,
  title,
  detail,
  children
}: {
  selected: boolean
  onSelect: () => void
  title: string
  detail: string
  children?: React.ReactNode
}) {
  return (
    <div
      onClick={onSelect}
      className={`cursor-default rounded-[3px] border px-3 py-2 transition-colors ${
        selected ? 'border-accent bg-accent/8' : 'border-line hover:border-faint'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
            selected ? 'border-accent' : 'border-line'
          }`}
          aria-hidden
        >
          {selected ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-text">{title}</p>
          <p className="tabular mt-0.5 text-[11px] leading-relaxed break-all text-muted">{detail}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
