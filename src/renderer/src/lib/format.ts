/** Display formatting. Everything here is read at a glance in a dense table. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/**
 * Base-1024 with short labels, matching what every other file manager shows.
 * Sizes stay at one decimal so the column keeps a predictable width.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  return `${exponent === 0 ? value : value.toFixed(1)} ${UNITS[exponent]}`
}

/** Total bytes across a listing, for the manifest strip. */
export function sumBytes(sizes: number[]): number {
  return sizes.reduce((total, size) => total + size, 0)
}

const DATE = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit'
})

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

/** Today's objects show a time; older ones show a date. Both fit the same column. */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  return sameDay ? TIME.format(date) : DATE.format(date)
}

export function formatFullTimestamp(iso: string | undefined): string {
  if (!iso) return 'Unknown'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'Unknown' : `${DATE.format(date)} ${TIME.format(date)}`
}

/**
 * Shortens a storage class for a narrow column.
 *
 * Every object gets one, including the default: leaving Standard blank made the column
 * look like missing data in the common case where a whole bucket is Standard. It is
 * rendered quietly instead, so anything unusual still stands out.
 */
export function formatStorageClass(storageClass: string | undefined): string {
  if (!storageClass) return 'standard'

  const shortened: Record<string, string> = {
    STANDARD: 'standard',
    STANDARD_IA: 'standard-ia',
    ONEZONE_IA: 'onezone-ia',
    INTELLIGENT_TIERING: 'intelligent',
    GLACIER_IR: 'glacier-ir',
    GLACIER: 'glacier',
    DEEP_ARCHIVE: 'deep archive',
    REDUCED_REDUNDANCY: 'reduced',
    OUTPOSTS: 'outposts',
    EXPRESS_ONEZONE: 'express'
  }
  return shortened[storageClass] ?? storageClass.replace(/_/g, ' ').toLowerCase()
}

/** True for the class objects get when nobody chose one. */
export function isDefaultStorageClass(storageClass: string | undefined): boolean {
  return !storageClass || storageClass === 'STANDARD'
}

/** Splits a prefix into breadcrumb segments, each carrying its own full prefix. */
export function breadcrumbs(prefix: string): Array<{ name: string; prefix: string }> {
  const segments = prefix.split('/').filter(Boolean)
  let walked = ''
  return segments.map((name) => {
    walked += `${name}/`
    return { name, prefix: walked }
  })
}

/** The file extension, uppercased, for the type marker in the list. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toUpperCase().slice(0, 4)
}
