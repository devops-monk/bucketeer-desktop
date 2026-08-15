import { useEffect, useMemo, useRef, useState } from 'react'
import type { S3Object, S3Prefix } from '@shared/types'
import { extensionOf, formatBytes, formatStorageClass, formatTimestamp } from '../lib/format'
import { useSession } from '../store/session'
import { FileIcon, FolderIcon } from './icons'
import { Button, Tooltip } from './primitives'

type SortColumn = 'name' | 'size' | 'modified'
type SortDirection = 'asc' | 'desc'

/**
 * The object list.
 *
 * Folders sort above files the way every file manager behaves, and the columns holding
 * machine values — size, modified, class — are monospace and right-aligned so a column
 * can be scanned vertically without reading it.
 */
export function ObjectTable({ onOpenDetails }: { onOpenDetails: (key: string) => void }) {
  const listing = useSession((state) => state.listing)
  const filter = useSession((state) => state.filter)
  const selection = useSession((state) => state.selection)
  const prefixSelection = useSession((state) => state.prefixSelection)
  const navigateTo = useSession((state) => state.navigateTo)
  const toggleSelection = useSession((state) => state.toggleSelection)
  const togglePrefixSelection = useSession((state) => state.togglePrefixSelection)
  const selectAll = useSession((state) => state.selectAll)
  const clearSelection = useSession((state) => state.clearSelection)
  const loadMore = useSession((state) => state.loadMore)
  const loadingMore = useSession((state) => state.loadingMore)

  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'name',
    direction: 'asc'
  })
  const sentinel = useRef<HTMLDivElement>(null)

  // The filter applies to what has been loaded. S3 cannot filter server-side beyond a
  // prefix, so filtering a truncated listing filters this page, not the whole bucket.
  const visible = useMemo(() => {
    if (!listing) return { prefixes: [] as S3Prefix[], objects: [] as S3Object[] }

    const needle = filter.trim().toLowerCase()
    const prefixes = needle
      ? listing.prefixes.filter((prefix) => prefix.name.toLowerCase().includes(needle))
      : listing.prefixes
    const objects = needle
      ? listing.objects.filter((object) => object.name.toLowerCase().includes(needle))
      : listing.objects

    const flip = sort.direction === 'asc' ? 1 : -1
    // Folders have no size or date of their own, so they always sort by name and always
    // stay above files — sorting by size must not scatter them through the list.
    const sortedPrefixes = [...prefixes].sort((a, b) => a.name.localeCompare(b.name) * flip)
    const sortedObjects = [...objects].sort((a, b) => {
      if (sort.column === 'size') return (a.size - b.size) * flip
      if (sort.column === 'modified') {
        return (Date.parse(a.lastModified ?? '') - Date.parse(b.lastModified ?? '')) * flip
      }
      return a.name.localeCompare(b.name) * flip
    })

    return { prefixes: sortedPrefixes, objects: sortedObjects }
  }, [listing, filter, sort])

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

  const shown = visible.prefixes.length + visible.objects.length
  const hidden = listing.prefixes.length + listing.objects.length - shown
  const selectedCount = selection.size + prefixSelection.size
  const allSelected = shown > 0 && selectedCount >= shown

  function toggleSort(column: SortColumn) {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: column === 'name' ? 'asc' : 'desc' }
    )
  }

  return (
    <div className="rise flex-1 overflow-y-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
          <tr className="border-b border-line">
            <th className="w-9 px-3 py-2">
              <Checkbox
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                onChange={() => (allSelected ? clearSelection() : selectAll())}
                label={allSelected ? 'Clear selection' : 'Select everything here'}
              />
            </th>
            <SortableTh
              label="Name"
              column="name"
              sort={sort}
              onSort={toggleSort}
              className="w-full text-left"
            />
            <SortableTh label="Size" column="size" sort={sort} onSort={toggleSort} className="text-right" />
            <SortableTh
              label="Modified"
              column="modified"
              sort={sort}
              onSort={toggleSort}
              className="text-right"
            />
            <th className="eyebrow w-24 px-3 py-2 pr-5 text-right font-normal whitespace-nowrap">
              Class
            </th>
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

function SortableTh({
  label,
  column,
  sort,
  onSort,
  className = ''
}: {
  label: string
  column: SortColumn
  sort: { column: SortColumn; direction: SortDirection }
  onSort: (column: SortColumn) => void
  className?: string
}) {
  const active = sort.column === column
  return (
    <th className={`px-3 py-2 font-normal ${className}`}>
      <button
        onClick={() => onSort(column)}
        className={`eyebrow inline-flex items-center gap-1 hover:text-text ${active ? 'text-accent-ink' : ''}`}
        aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        {/* The caret only appears on the active column: a row of them is noise. */}
        <span className={active ? 'opacity-100' : 'opacity-0'}>
          {sort.direction === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  )
}

/**
 * A checkbox drawn as a styled span. Native checkboxes cannot be restyled consistently
 * across platforms, and this one has to sit on a dense row without dominating it.
 */
function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onChange()
      }}
      className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors ${
        checked || indeterminate
          ? 'border-accent bg-accent text-on-accent'
          : 'border-line hover:border-faint'
      }`}
    >
      {indeterminate ? (
        <span className="h-px w-2 bg-current" />
      ) : checked ? (
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden>
          <path
            d="M1.5 5.2 3.9 7.5 8.5 2.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </button>
  )
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
      className={`group cursor-default border-b border-line-soft transition-colors duration-100 ${
        selected ? 'bg-accent-soft/50' : 'hover:bg-hover'
      }`}
    >
      <td className="px-3 py-2">
        <Checkbox checked={selected} onChange={() => onSelect(true)} label={`Select ${prefix.name}`} />
      </td>
      <td className="px-3 py-2">
        <button
          onClick={(event) => {
            // Opening the folder is a different intent from selecting it.
            event.stopPropagation()
            onOpen()
          }}
          className="flex items-center gap-2.5 text-left"
        >
          <Tooltip label="Folder — double-click to open">
            <FolderIcon className="text-accent-ink transition-transform duration-150 group-hover:scale-110" />
          </Tooltip>
          <span className="tabular truncate text-[12.5px] text-text group-hover:text-accent-ink">
            {prefix.name}
          </span>
        </button>
      </td>
      <td className="tabular px-3 py-2 text-right text-[11.5px] text-faint">—</td>
      <td className="tabular px-3 py-2 text-right text-[11.5px] text-faint">—</td>
      <td className="px-3 py-2 pr-5" />
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
      className={`cursor-default border-b border-line-soft transition-colors duration-100 ${
        selected ? 'bg-accent-soft/50' : 'hover:bg-hover'
      }`}
    >
      <td className="px-3 py-2">
        <Checkbox checked={selected} onChange={() => onSelect(true)} label={`Select ${object.name}`} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2.5">
          <Tooltip label="Object — double-click for details">
            <FileIcon className="text-faint" />
          </Tooltip>
          <span className="tabular truncate text-[12.5px] text-text">{object.name}</span>
          {/* The extension repeats what the name ends in, so it stays quiet: it exists
              to make a column of mixed types scannable, not to label each row twice. */}
          {extension ? (
            <span className="tabular shrink-0 rounded-[2px] border border-line px-1 text-[9px] tracking-wide text-faint uppercase">
              {extension}
            </span>
          ) : null}
        </div>
      </td>
      <td className="tabular px-3 py-2 text-right text-[11.5px] whitespace-nowrap text-muted">
        {formatBytes(object.size)}
      </td>
      <td className="tabular px-3 py-2 text-right text-[11.5px] whitespace-nowrap text-faint">
        {formatTimestamp(object.lastModified)}
      </td>
      <td className="px-3 py-2 pr-5 text-right">
        {storageClass ? (
          <span className="tabular text-[10px] tracking-wide text-accent-ink uppercase">
            {storageClass}
          </span>
        ) : null}
      </td>
    </tr>
  )
}
