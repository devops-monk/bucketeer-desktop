import { useEffect, useState } from 'react'
import type { ObjectDetail } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { formatBytes, formatFullTimestamp } from '../lib/format'
import { useSession } from '../store/session'

/**
 * Details for a single object, including how it is encrypted.
 *
 * Encryption is the reason this panel exists: a listing cannot tell you whether an
 * object is protected by the key you expect, and for KMS-encrypted buckets that is
 * exactly what people need to confirm.
 */
export function ObjectDetails({ objectKey, onClose }: { objectKey: string; onClose: () => void }) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)

  const [detail, setDetail] = useState<ObjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!connectionId || !location) return
    let cancelled = false

    setDetail(null)
    setError(null)
    api.objects
      .head(connectionId, location.bucket, objectKey)
      .then((result) => {
        if (!cancelled) setDetail(result)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(messageFor(failure))
      })

    // The user can click another row before this resolves; ignore the stale answer.
    return () => {
      cancelled = true
    }
  }, [connectionId, location, objectKey])

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="eyebrow">Object</span>
        <button onClick={onClose} className="text-faint hover:text-text" aria-label="Close details">
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <p className="tabular mb-4 text-[12px] break-all text-text">{objectKey}</p>

        {error ? <p className="text-[12px] leading-relaxed text-danger">{error}</p> : null}
        {!detail && !error ? <p className="text-[12px] text-faint">Loading…</p> : null}

        {detail ? (
          <dl className="flex flex-col gap-2.5">
            <Row label="Size" value={`${formatBytes(detail.size)} (${detail.size.toLocaleString()} bytes)`} />
            <Row label="Modified" value={formatFullTimestamp(detail.lastModified)} />
            <Row label="Type" value={detail.contentType ?? 'Unknown'} />
            <Row label="Storage class" value={detail.storageClass ?? 'STANDARD'} />
            <Row
              label="Encryption"
              value={detail.serverSideEncryption ?? 'None'}
              tone={detail.serverSideEncryption ? 'good' : 'plain'}
            />
            {detail.kmsKeyId ? <Row label="KMS key" value={detail.kmsKeyId} /> : null}
            <Row label="ETag" value={detail.etag ?? '—'} />

            {detail.metadata && Object.keys(detail.metadata).length > 0 ? (
              <div className="mt-2 border-t border-line-soft pt-2.5">
                <span className="eyebrow">User metadata</span>
                <dl className="mt-2 flex flex-col gap-2">
                  {Object.entries(detail.metadata).map(([name, value]) => (
                    <Row key={name} label={name} value={value} />
                  ))}
                </dl>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </aside>
  )
}

function Row({
  label,
  value,
  tone = 'plain'
}: {
  label: string
  value: string
  tone?: 'plain' | 'good'
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={`tabular text-[11.5px] break-all ${tone === 'good' ? 'text-success' : 'text-muted'}`}
      >
        {value}
      </dd>
    </div>
  )
}
