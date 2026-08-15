import { useEffect, useRef } from 'react'
import type { Transfer } from '@shared/types'
import type { Location } from '../store/session'
import { useSession } from '../store/session'
import { isActive, useTransfers } from '../store/transfers'

/**
 * Decides whether a finished batch of uploads should reload the current listing.
 *
 * Pure, and separate from the hook, because the rules are the fiddly part: wait for the
 * batch to settle, ignore uploads already accounted for, and ignore anything that did
 * not land in the folder on screen.
 */
export function shouldReload(
  transfers: Transfer[],
  location: Location | null,
  seen: ReadonlySet<string>
): { reload: boolean; accounted: string[] } {
  // Waiting for the queue to settle: fifty files would otherwise trigger fifty
  // listings, each discarding the results of the last.
  if (transfers.some(isActive)) return { reload: false, accounted: [] }

  const landed = transfers.filter(
    (transfer) => transfer.kind === 'upload' && transfer.status === 'done' && !seen.has(transfer.id)
  )
  if (landed.length === 0) return { reload: false, accounted: [] }

  const accounted = landed.map((transfer) => transfer.id)
  if (!location) return { reload: false, accounted }

  // Only the folder on screen matters. An upload elsewhere — or one the user has since
  // navigated away from — must not yank the current listing out from under them.
  const reload = landed.some(
    (transfer) => transfer.bucket === location.bucket && transfer.key.startsWith(location.prefix)
  )
  return { reload, accounted }
}

/**
 * Reloads the listing once an upload lands in the folder being viewed.
 *
 * S3 gives us no change notification, so without this a file you just uploaded is simply
 * absent until you think to press refresh — which reads as the upload having failed.
 */
export function useListingAutoRefresh(): void {
  const transfers = useTransfers((state) => state.transfers)
  const location = useSession((state) => state.location)
  const refresh = useSession((state) => state.refresh)

  const seen = useRef(new Set<string>())

  useEffect(() => {
    const { reload, accounted } = shouldReload(transfers, location, seen.current)
    for (const id of accounted) seen.current.add(id)
    if (reload) void refresh()
  }, [transfers, location, refresh])
}
