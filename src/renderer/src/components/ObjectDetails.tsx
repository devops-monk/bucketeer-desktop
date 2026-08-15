import { useCallback, useEffect, useState } from 'react'
import type { ObjectDetail } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { formatBytes, formatFullTimestamp } from '../lib/format'
import { useSession } from '../store/session'
import { Button, Input, Tooltip } from './primitives'

type Tab = 'details' | 'headers' | 'tags'

/**
 * Everything about one object other than its bytes.
 *
 * Encryption is why this panel first existed — a listing cannot tell you whether an
 * object is protected by the key you expect. It now also edits the two things people
 * come here to change: the headers S3 serves the object with, and its tags.
 */
export function ObjectDetails({ objectKey, onClose }: { objectKey: string; onClose: () => void }) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)

  const [tab, setTab] = useState<Tab>('details')
  const [detail, setDetail] = useState<ObjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!connectionId || !location) return
    setDetail(null)
    setError(null)
    try {
      setDetail(await api.objects.head(connectionId, location.bucket, objectKey))
    } catch (failure) {
      setError(messageFor(failure))
    }
  }, [connectionId, location, objectKey])

  useEffect(() => {
    void load()
    setTab('details')
  }, [load])

  const archived =
    detail?.storageClass === 'GLACIER' || detail?.storageClass === 'DEEP_ARCHIVE'

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-line bg-surface">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="eyebrow">Object</span>
        <button onClick={onClose} className="text-faint hover:text-text" aria-label="Close details">
          ✕
        </button>
      </header>

      <p className="tabular border-b border-line-soft px-3 py-2.5 text-[12px] break-all text-text">
        {objectKey}
      </p>

      <nav className="flex shrink-0 gap-1 border-b border-line-soft px-2 py-1.5">
        {(['details', 'headers', 'tags'] as Tab[]).map((value) => (
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

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error ? <p className="text-[12px] leading-relaxed text-danger">{error}</p> : null}
        {!detail && !error ? <p className="text-[12px] text-faint">Loading…</p> : null}

        {detail && tab === 'details' ? (
          <Details detail={detail} archived={archived} objectKey={objectKey} onChanged={load} />
        ) : null}

        {detail && tab === 'headers' ? (
          <HeadersEditor detail={detail} objectKey={objectKey} onSaved={load} />
        ) : null}

        {detail && tab === 'tags' ? <TagsEditor objectKey={objectKey} /> : null}
      </div>
    </aside>
  )
}

function Details({
  detail,
  archived,
  objectKey,
  onChanged
}: {
  detail: ObjectDetail
  archived: boolean
  objectKey: string
  onChanged: () => Promise<void>
}) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function restore() {
    if (!connectionId || !location) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.objects.restore({
        connectionId,
        bucket: location.bucket,
        keys: [objectKey],
        days: 7,
        tier: 'Standard'
      })
      setMessage(
        result.started > 0
          ? 'Restore started. Standard retrieval takes minutes for Glacier and up to twelve hours for Deep Archive.'
          : (result.failed[0]?.reason ?? 'Nothing was restored.')
      )
      await onChanged()
    } catch (failure) {
      setMessage(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
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

      {detail.restoreStatus ? (
        <Row
          label="Restore"
          value={
            detail.restoreStatus.includes('ongoing-request="true"')
              ? 'In progress'
              : detail.restoreStatus
          }
          tone="good"
        />
      ) : null}

      {archived && !detail.restoreStatus ? (
        <div className="mt-1 rounded-md border border-line bg-sunken px-3 py-2.5">
          <p className="text-[11.5px] leading-relaxed text-muted">
            This object is archived and cannot be downloaded until it is restored. A restored
            copy stays readable for seven days.
          </p>
          <Button variant="secondary" className="mt-2" onClick={() => void restore()} disabled={busy}>
            {busy ? 'Starting…' : 'Restore for 7 days'}
          </Button>
        </div>
      ) : null}

      {message ? (
        <p className="text-[11.5px] leading-relaxed text-muted">{message}</p>
      ) : null}
    </dl>
  )
}

/**
 * The headers S3 serves this object with.
 *
 * Every field is sent on save, not only the changed ones: S3 replaces the whole set, so
 * anything left out would be dropped rather than kept.
 */
function HeadersEditor({
  detail,
  objectKey,
  onSaved
}: {
  detail: ObjectDetail
  objectKey: string
  onSaved: () => Promise<void>
}) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)

  const [contentType, setContentType] = useState(detail.contentType ?? '')
  const [cacheControl, setCacheControl] = useState(detail.cacheControl ?? '')
  const [disposition, setDisposition] = useState(detail.contentDisposition ?? '')
  const [encoding, setEncoding] = useState(detail.contentEncoding ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!connectionId || !location) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api.objects.setHeaders(connectionId, location.bucket, objectKey, {
        contentType: contentType || undefined,
        cacheControl: cacheControl || undefined,
        contentDisposition: disposition || undefined,
        contentEncoding: encoding || undefined,
        metadata: detail.metadata,
        storageClass: detail.storageClass
      })
      setSaved(true)
      await onSaved()
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] leading-relaxed text-muted">
        These decide how a browser treats the object. Saving rewrites it in place, which
        changes its last-modified date.
      </p>

      <HeaderField
        label="Content-Type"
        hint="text/csv, image/png, application/json"
        value={contentType}
        onChange={setContentType}
      />
      <HeaderField
        label="Cache-Control"
        hint="max-age=31536000, no-cache"
        value={cacheControl}
        onChange={setCacheControl}
      />
      <HeaderField
        label="Content-Disposition"
        hint="attachment; filename=report.csv"
        value={disposition}
        onChange={setDisposition}
      />
      <HeaderField label="Content-Encoding" hint="gzip, br" value={encoding} onChange={setEncoding} />

      {detail.metadata && Object.keys(detail.metadata).length > 0 ? (
        <div>
          <span className="eyebrow">User metadata</span>
          <dl className="mt-1.5 flex flex-col gap-1.5">
            {Object.entries(detail.metadata).map(([name, value]) => (
              <Row key={name} label={name} value={value} />
            ))}
          </dl>
        </div>
      ) : null}

      {error ? <p className="text-[11.5px] text-danger">{error}</p> : null}
      {saved ? <p className="text-[11.5px] text-success">Headers updated.</p> : null}

      <Button variant="primary" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving…' : 'Save headers'}
      </Button>
    </div>
  )
}

function HeaderField({
  label,
  hint,
  value,
  onChange
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={hint}
        className="tabular"
      />
    </label>
  )
}

/** Tags drive lifecycle rules and cost allocation, and are invisible without this. */
function TagsEditor({ objectKey }: { objectKey: string }) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)

  const [tags, setTags] = useState<Array<{ name: string; value: string }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!connectionId || !location) return
    let cancelled = false

    api.objects
      .tags(connectionId, location.bucket, objectKey)
      .then((found) => {
        if (!cancelled) {
          setTags(Object.entries(found).map(([name, value]) => ({ name, value })))
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setError(messageFor(failure))
          setTags([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, location, objectKey])

  async function save() {
    if (!connectionId || !location || !tags) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const set = Object.fromEntries(
        tags.filter((tag) => tag.name.trim()).map((tag) => [tag.name.trim(), tag.value])
      )
      await api.objects.setTags(connectionId, location.bucket, objectKey, set)
      setSaved(true)
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  if (!tags) return <p className="text-[12px] text-faint">Loading…</p>

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] leading-relaxed text-muted">
        Up to ten per object. Lifecycle rules and cost allocation reports are written against
        these.
      </p>

      <div className="flex flex-col gap-1.5">
        {tags.map((tag, index) => (
          <div key={index} className="flex gap-1.5">
            <Input
              value={tag.name}
              onChange={(event) =>
                setTags(tags.map((t, i) => (i === index ? { ...t, name: event.target.value } : t)))
              }
              placeholder="Name"
              className="tabular flex-1"
            />
            <Input
              value={tag.value}
              onChange={(event) =>
                setTags(tags.map((t, i) => (i === index ? { ...t, value: event.target.value } : t)))
              }
              placeholder="Value"
              className="tabular flex-1"
            />
            <Tooltip label="Remove this tag">
              <Button
                onClick={() => setTags(tags.filter((_, i) => i !== index))}
                aria-label={`Remove tag ${tag.name}`}
              >
                ✕
              </Button>
            </Tooltip>
          </div>
        ))}

        {tags.length === 0 ? <p className="text-[12px] text-faint">No tags on this object.</p> : null}
      </div>

      <div className="flex gap-1.5">
        <Button
          variant="secondary"
          onClick={() => setTags([...tags, { name: '', value: '' }])}
          disabled={tags.length >= 10}
        >
          Add tag
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save tags'}
        </Button>
      </div>

      {error ? <p className="text-[11.5px] text-danger">{error}</p> : null}
      {saved ? <p className="text-[11.5px] text-success">Tags updated.</p> : null}
    </div>
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
