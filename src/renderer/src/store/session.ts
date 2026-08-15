import { create } from 'zustand'
import type {
  Bucket,
  ConnectionSummary,
  ListingPage,
  S3Object,
  UploadEncryption
} from '@shared/types'
import { api, messageFor } from '../lib/api'

/**
 * Session state: which connection is open, where we are inside it, and what the last
 * listing returned. Kept deliberately flat — one store, explicit actions — so the data
 * flow stays readable as transfers and multi-pane browsing land on top of it.
 */

export interface Location {
  bucket: string
  prefix: string
}

interface SessionState {
  connections: ConnectionSummary[]
  activeConnectionId: string | null
  buckets: Bucket[]
  location: Location | null
  listing: ListingPage | null
  /** Selected object keys. */
  selection: Set<string>
  /** Selected prefixes, which delete and download treat as whole folders. */
  prefixSelection: Set<string>
  /** Case-insensitive substring filter applied to the current listing. */
  filter: string
  /** An explicit encryption choice for uploads, until the bucket changes. */
  uploadOverride: UploadEncryption | null
  /** Where the right-click menu is open, if it is. */
  contextMenu: { x: number; y: number } | null
  /** The object whose details panel is open. */
  detailsKey: string | null
  /** Which panel the details drawer opens on, so "Preview" can land straight on it. */
  detailsTab: 'details' | 'preview'
  loading: boolean
  loadingMore: boolean
  error: string | null

  loadConnections: () => Promise<void>
  openConnection: (id: string) => Promise<void>
  closeConnection: () => void
  openBucket: (bucket: string) => Promise<void>
  navigateTo: (prefix: string) => Promise<void>
  goUp: () => Promise<void>
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  toggleSelection: (key: string, additive: boolean) => void
  togglePrefixSelection: (prefix: string, additive: boolean) => void
  clearSelection: () => void
  selectAll: () => void
  setFilter: (filter: string) => void
  setUploadOverride: (encryption: UploadEncryption | null) => void
  setContextMenu: (position: { x: number; y: number } | null) => void
  setDetailsKey: (key: string | null, tab?: 'details' | 'preview') => void
}

export const useSession = create<SessionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  buckets: [],
  location: null,
  listing: null,
  selection: new Set(),
  prefixSelection: new Set(),
  filter: '',
  uploadOverride: null,
  contextMenu: null,
  detailsKey: null,
  detailsTab: 'details',
  loading: false,
  loadingMore: false,
  error: null,

  async loadConnections() {
    try {
      set({ connections: await api.connections.list(), error: null })
    } catch (error) {
      set({ error: messageFor(error) })
    }
  },

  async openConnection(id) {
    set({ activeConnectionId: id, loading: true, error: null, location: null, listing: null })
    try {
      set({ buckets: await api.buckets.list(id), loading: false })
    } catch (error) {
      set({ error: messageFor(error), loading: false, buckets: [] })
    }
  },

  closeConnection() {
    set({
      activeConnectionId: null,
      buckets: [],
      location: null,
      listing: null,
      selection: new Set(),
      prefixSelection: new Set(),
      filter: '',
      error: null
    })
  },

  async openBucket(bucket) {
    // The override belongs to the bucket it was chosen for, never the next one.
    set({ location: { bucket, prefix: '' }, uploadOverride: null })
    await get().refresh()
  },

  async navigateTo(prefix) {
    const location = get().location
    if (!location) return
    set({ location: { ...location, prefix } })
    await get().refresh()
  },

  async goUp() {
    const location = get().location
    if (!location) return
    if (!location.prefix) {
      // Already at the bucket root: step back out to the bucket list.
      set({ location: null, listing: null, selection: new Set(), prefixSelection: new Set() })
      return
    }
    const parent = location.prefix.replace(/[^/]+\/$/, '')
    await get().navigateTo(parent)
  },

  async refresh() {
    const { activeConnectionId, location } = get()
    if (!activeConnectionId || !location) return

    set({
      loading: true,
      error: null,
      selection: new Set(),
      prefixSelection: new Set(),
      contextMenu: null,
      detailsKey: null
    })
    try {
      const listing = await api.objects.list({
        connectionId: activeConnectionId,
        bucket: location.bucket,
        prefix: location.prefix
      })
      set({ listing, loading: false })
    } catch (error) {
      set({ error: messageFor(error), loading: false, listing: null })
    }
  },

  async loadMore() {
    const { activeConnectionId, location, listing, loadingMore } = get()
    if (!activeConnectionId || !location || !listing?.nextToken || loadingMore) return

    set({ loadingMore: true })
    try {
      const page = await api.objects.list({
        connectionId: activeConnectionId,
        bucket: location.bucket,
        prefix: location.prefix,
        token: listing.nextToken
      })
      // Pages append; S3 returns each key exactly once across a continuation sequence.
      set({
        listing: {
          prefixes: [...listing.prefixes, ...page.prefixes],
          objects: [...listing.objects, ...page.objects],
          nextToken: page.nextToken
        },
        loadingMore: false
      })
    } catch (error) {
      set({ error: messageFor(error), loadingMore: false })
    }
  },

  togglePrefixSelection(prefix, additive) {
    const current = get().prefixSelection
    if (!additive) {
      const onlyThis = current.size === 1 && current.has(prefix)
      set({ prefixSelection: onlyThis ? new Set() : new Set([prefix]), selection: new Set() })
      return
    }
    const next = new Set(current)
    if (next.has(prefix)) next.delete(prefix)
    else next.add(prefix)
    set({ prefixSelection: next })
  },

  setFilter(filter) {
    set({ filter })
  },

  setUploadOverride(encryption) {
    set({ uploadOverride: encryption })
  },

  setContextMenu(position) {
    set({ contextMenu: position })
  },

  setDetailsKey(key, tab = 'details') {
    set({ detailsKey: key, detailsTab: tab })
  },

  toggleSelection(key, additive) {
    const current = get().selection
    if (!additive) {
      // A plain click replaces the selection unless it's already the only thing selected.
      const onlyThis = current.size === 1 && current.has(key)
      set({ selection: onlyThis ? new Set() : new Set([key]), prefixSelection: new Set() })
      return
    }
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    set({ selection: next })
  },

  clearSelection() {
    set({ selection: new Set(), prefixSelection: new Set() })
  },

  selectAll() {
    const listing = get().listing
    set({
      selection: new Set((listing?.objects ?? []).map((object: S3Object) => object.key)),
      // Folders are selectable too, so "select all" that skipped them would be a lie.
      prefixSelection: new Set((listing?.prefixes ?? []).map((prefix) => prefix.prefix))
    })
  }
}))
