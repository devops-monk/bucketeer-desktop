import { describe, expect, it } from 'vitest'
import type { Transfer, TransferStatus } from '@shared/types'
import { percentOf, summarise } from '../src/shared/transfer-summary'

/**
 * The batch arithmetic behind the progress figure. It had the shape of a rounding
 * detail and behaved like a broken feature: a folder download of many files reported
 * 0% for its whole life, because finished files were dropped from both sides of the
 * fraction at once.
 */

const MB = 1024 * 1024

function transfer(status: TransferStatus, size: number, transferred: number): Transfer {
  return {
    id: `${status}-${size}-${transferred}-${Math.random()}`,
    kind: 'download',
    name: 'file.bin',
    bucket: 'bucket',
    key: 'folder/file.bin',
    localPath: '/tmp/file.bin',
    size,
    transferred,
    status
  }
}

/** 200 files of 1 MB: `done` of them finished, three part-way through. */
function folderDownload(done: number): Transfer[] {
  return [
    ...Array.from({ length: done }, () => transfer('done', MB, MB)),
    ...Array.from({ length: 3 }, () => transfer('running', MB, MB / 2)),
    ...Array.from({ length: 200 - done - 3 }, () => transfer('queued', MB, 0))
  ]
}

describe('batch progress', () => {
  it('climbs as files finish', async () => {
    const early = percentOf(summarise(folderDownload(20)))
    const later = percentOf(summarise(folderDownload(120)))

    expect(early).toBe(11)
    expect(later).toBe(61)
    expect(later).toBeGreaterThan(early!)
  })

  it('counts every file in the batch, not only the ones moving', () => {
    const summary = summarise(folderDownload(120))

    expect(summary.files).toBe(200)
    expect(summary.completed).toBe(120)
    expect(summary.active).toBe(80)
    expect(summary.total).toBe(200 * MB)
  })

  it('reaches 100% when the batch finishes', () => {
    const summary = summarise(Array.from({ length: 5 }, () => transfer('done', MB, MB)))

    expect(percentOf(summary)).toBe(100)
    expect(summary.active).toBe(0)
  })

  it('keeps a paused file in the batch, because it is still going to arrive', () => {
    const summary = summarise([transfer('done', MB, MB), transfer('paused', MB, MB / 4)])

    expect(summary.files).toBe(2)
    expect(percentOf(summary)).toBe(63)
  })

  it('leaves failures and cancellations out of the totals, and reports them separately', () => {
    const summary = summarise([
      transfer('done', MB, MB),
      transfer('failed', MB, MB / 2),
      transfer('cancelled', MB, MB / 3)
    ])

    // Otherwise a batch that is as finished as it will ever get sits below 100% forever.
    expect(percentOf(summary)).toBe(100)
    expect(summary.files).toBe(1)
    expect(summary.failed).toBe(1)
  })

  it('reports no percentage while no size is known yet', () => {
    expect(percentOf(summarise([transfer('queued', 0, 0)]))).toBeNull()
  })
})
