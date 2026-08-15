import { useEffect, useMemo, useState } from 'react'
import type { ObjectPreview } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { formatBytes } from '../lib/format'
import { useSession } from '../store/session'
import { Button } from './primitives'

/** Read for text: enough for a header row and a look at the shape of the data. */
const TEXT_BYTES = 256 * 1024
/** Read for images: most screenshots and diagrams fit, and anything larger is not a preview. */
const IMAGE_BYTES = 4 * 1024 * 1024

/**
 * Shows what an object contains without downloading it.
 *
 * Ranged requests, so previewing a 4 GB log costs one request for its first few hundred
 * kilobytes rather than the whole file. What arrives is always stated as a slice, never
 * presented as the complete object.
 */
export function ObjectPreviewPane({ objectKey }: { objectKey: string }) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)

  const [preview, setPreview] = useState<ObjectPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const kind = kindOf(objectKey)

  useEffect(() => {
    setPreview(null)
    setError(null)
  }, [objectKey])

  async function load() {
    if (!connectionId || !location) return
    setLoading(true)
    setError(null)
    try {
      setPreview(
        await api.objects.preview(
          connectionId,
          location.bucket,
          objectKey,
          kind === 'image' ? IMAGE_BYTES : TEXT_BYTES
        )
      )
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setLoading(false)
    }
  }

  const text = useMemo(() => {
    if (!preview || kind === 'image') return null
    return new TextDecoder().decode(preview.data)
  }, [preview, kind])

  const imageUrl = useMemo(() => {
    if (!preview || kind !== 'image') return null
    // A blob URL rather than a data URI: no base64 inflation, and it is revoked below.
    // The slice copies into a plain ArrayBuffer, which is what Blob accepts.
    const buffer = preview.data.slice().buffer as ArrayBuffer
    return URL.createObjectURL(new Blob([buffer], { type: preview.contentType }))
  }, [preview, kind])

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [imageUrl])

  if (kind === 'binary') {
    return (
      <p className="text-[11.5px] leading-relaxed text-muted">
        This looks like a binary file, so there is nothing readable to show. Download it to
        open it in something that understands the format.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {!preview && !loading ? (
        <>
          <p className="text-[11.5px] leading-relaxed text-muted">
            Reads the first {formatBytes(kind === 'image' ? IMAGE_BYTES : TEXT_BYTES)} of this
            object rather than downloading it.
          </p>
          <Button variant="secondary" onClick={() => void load()}>
            Show preview
          </Button>
        </>
      ) : null}

      {loading ? <p className="text-[12px] text-faint">Reading…</p> : null}
      {error ? <p className="text-[11.5px] leading-relaxed text-danger">{error}</p> : null}

      {preview ? (
        <>
          {preview.truncated ? (
            <p className="text-[11px] text-faint">
              First {formatBytes(preview.data.length)} of {formatBytes(preview.size)}.
            </p>
          ) : null}

          {kind === 'image' && imageUrl ? (
            <img
              src={imageUrl}
              alt={objectKey}
              className="max-h-80 w-full rounded-md border border-line object-contain"
            />
          ) : null}

          {kind === 'json' && text ? <JsonPreview text={text} /> : null}

          {kind === 'text' && text ? (
            <pre className="tabular max-h-80 overflow-auto rounded-md border border-line bg-sunken p-2.5 text-[11px] leading-relaxed whitespace-pre text-muted">
              {text}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** Pretty-printed when it parses; shown raw when it does not, rather than an error. */
function JsonPreview({ text }: { text: string }) {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }, [text])

  return (
    <pre className="tabular max-h-80 overflow-auto rounded-md border border-line bg-sunken p-2.5 text-[11px] leading-relaxed whitespace-pre text-muted">
      {formatted}
    </pre>
  )
}

/**
 * Decided from the extension rather than the stored Content-Type, which is wrong often
 * enough — plenty of buckets serve everything as application/octet-stream.
 */
function kindOf(key: string): 'text' | 'json' | 'image' | 'binary' {
  const extension = key.split('.').pop()?.toLowerCase() ?? ''

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(extension)) {
    return 'image'
  }
  if (['json', 'geojson', 'ndjson'].includes(extension)) return 'json'
  if (
    [
      'txt', 'csv', 'tsv', 'log', 'md', 'yml', 'yaml', 'xml', 'html', 'css', 'js', 'ts',
      'sql', 'sh', 'conf', 'ini', 'env', 'toml', 'properties'
    ].includes(extension)
  ) {
    return 'text'
  }
  return 'binary'
}
