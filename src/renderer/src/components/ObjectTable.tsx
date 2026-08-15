import { useEffect, useMemo, useRef } from 'react'
import type { S3Object, S3Prefix } from '@shared/types'
import { extensionOf, formatBytes, formatStorageClass, formatTimestamp } from '../lib/format'
import { useSession } from '../store/session'
import { Button } from './primitives'

/**
 * The object list.
 *
 * Prefixes sort above objects, the way every file manager behaves, and the columns that
 * hold machine values — size, modified, class — are monospace and right-aligned so they
 * can be scanned vertically without reading them.
 */
export function ObjectTable({ onOpenDetails }: { onOpenDetails: (key: string) => void }) {
  const listing = useSession((state) => state.listing)
  const filter = useSession((state) => state.filter)
  const selection = useSession((state) => state.selection)
  const prefixSelection = useSession((state) => state.prefixSelection)
  const navigateTo = useSession((state) => state.navigateTo)
  const toggleSelection = useSession((state) => state.toggleSelection)
  const togglePrefixSelection = useSession((state) => state.togglePrefixSelection)
  const loadMore = useSession((state) => state.loadMore)
  const loadingMore = useSession((state) => state.loadingMore)

  const sentinel = useRef<HTMLDivElement>(null)

  // The filter applies to what has been loaded. S3 cannot filter server-side beyond a
  // prefix, so filtering a truncated listing filters this page, not the whole bucket.
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!listing) return { prefixes: [] as S3Prefix[], objects: [] as S3Object[] }
    if (!needle) return { prefixes: listing.prefixes, objects: listing.objects }

    return {
      prefixes: listing.prefixes.filter((prefix) => prefix.name.toLowerCase().includes(needle)),
      objects: listing.objects.filter((object) => object.name.toLowerCase().includes(needle))
    }
  }, [listing, filter])

  // S3 pages at 1000 keys; fetch the next page as the end of the list comes into view.
  useEffect(() => {
    const node = sentinel.current
    if (!node || !listing?.nextToken) return

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [listing?.nextToken, loadMore])

  if (!listing) return null

  const hidden =
    listing.prefixes.length +
    listing.objects.length -
    visible.prefixes.length -
    visible.objects.length

  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr className="border-b border-line">
            <Th className="w-full text-left">Name</Th>
            <Th className="text-right">Size</Th>
            <Th className="text-right">Modified</Th>
            <Th className="pr-4 text-right">Class</Th>
          </tr>
        </thead>
        <tbody>
          {visible.prefixes.map((prefix) => (
            <PrefixRow
              key={prefix.prefix}
              prefix={prefix}
              selected={prefixSelection.has(prefix.prefix)}
              onOpen={() => void navigateTo(prefix.prefix)}
              onSelect={(additive) => togglePrefixSelection(prefix.prefix, additive)}
            />
          ))}
          {visible.objects.map((object) => (
            <ObjectRow
              key={object.key}
              object={object}
              selected={selection.has(object.key)}
              onSelect={(additive) => toggleSelection(object.key, additive)}
              onOpen={() => onOpenDetails(object.key)}
            />
          ))}
        </tbody>
      </table>

      {hidden > 0 ? (
        <p className="px-4 py-2 text-[11px] text-faint">{hidden} hidden by the filter</p>
      ) : null}

      {listing.nextToken ? (
        <div ref={sentinel} className="flex items-center justify-center py-4">
          <Button onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading more…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`eyebrow px-3 py-2 font-normal ${className}`}>{children}</th>
}

function PrefixRow({
  prefix,
  selected,
  onOpen,
  onSelect
}: {
  prefix: S3Prefix
  selected: boolean
  onOpen: () => void
  onSelect: (additive: boolean) => void
}) {
  return (
    <tr
      onClick={(event) => onSelect(event.metaKey || event.ctrlKey || event.shiftKey)}
      onDoubleClick={onOpen}
      aria-selected={selected}
      className={`group cursor-default border-b border-line-soft ${
        selected ? 'bg-accent/12' : 'hover:bg-raised'
      }`}
    >
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2.5">
          {/* Prefixes carry a pink chevron; objects never do, so the tree is scannable. */}
          <span className="w-6 shrink-0 text-center text-[11px] text-accent-ink" aria-hidden>
            ▸
          </span>
          <button
            onClick={(event) => {
              // Opening the folder is a different intent from selecting it.
              event.stopPropagation()
              onOpen()
            }}
            className="tabular truncate text-left text-[12.5px] text-text group-hover:text-accent-ink"
          >
            {prefix.name}
          </button>
        </div>
      </td>
      <td className="tabular px-3 py-1.5 text-right text-[11.5px] text-faint">—</td>
      <td className="tabular px-3 py-1.5 text-right text-[11.5px] text-faint">—</td>
      <td className="px-3 py-1.5 pr-4" />
    </tr>
  )
}

function ObjectRow({
  object,
  selected,
  onSelect,
  onOpen
}: {
  object: S3Object
  selected: boolean
  onSelect: (additive: boolean) => void
  onOpen: () => void
}) {
  const storageClass = formatStorageClass(object.storageClass)
  const extension = extensionOf(object.name)

  return (
    <tr
      onClick={(event) => onSelect(event.metaKey || event.ctrlKey || event.shiftKey)}
      onDoubleClick={onOpen}
      aria-selected={selected}
      className={`cursor-default border-b border-line-soft ${
        selected ? 'bg-accent/12' : 'hover:bg-raised'
      }`}
    >
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2.5">
          {/* The extension is the file's type marker — more informative than a generic icon. */}
          <span className="tabular w-6 shrink-0 text-center text-[9px] text-faint" aria-hidden>
            {extension || '·'}
          </span>
          <span className="tabular truncate text-[12.5px] text-text">{object.name}</span>
        </div>
      </td>
      <td className="tabular px-3 py-1.5 text-right text-[11.5px] whitespace-nowrap text-muted">
        {formatBytes(object.size)}
      </td>
      <td className="tabular px-3 py-1.5 text-right text-[11.5px] whitespace-nowrap text-faint">
        {formatTimestamp(object.lastModified)}
      </td>
      <td className="px-3 py-1.5 pr-4 text-right">
        {storageClass ? (
          <span className="tabular text-[10px] tracking-wide text-accent-ink uppercase">
            {storageClass}
          </span>
        ) : null}
      </td>
    </tr>
  )
}
