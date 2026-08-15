import { describe, expect, it } from 'vitest'
import type { Transfer } from '@shared/types'
import { shouldReload } from '../src/renderer/src/lib/auto-refresh'

/**
 * The rules that decide whether a finished upload reloads the listing. Worth testing
 * directly: getting them wrong either leaves an uploaded file invisible — which reads as
 * a failed upload — or reloads the listing under someone who has navigated elsewhere.
 */

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: 't1',
  kind: 'upload',
  name: 'q1.csv',
  bucket: 'reports-bucket',
  key: 'reports/q1.csv',
  localPath: '/tmp/q1.csv',
  size: 10,
  transferred: 10,
  status: 'done',
  ...over
})

const here = { bucket: 'reports-bucket', prefix: 'reports/' }

describe('shouldReload', () => {
  it('reloads once an upload lands in the folder on screen', () => {
    expect(shouldReload([transfer()], here, new Set()).reload).toBe(true)
  })

  it('waits until the whole batch has settled', () => {
    const batch = [transfer(), transfer({ id: 't2', status: 'running' })]
    expect(shouldReload(batch, here, new Set()).reload).toBe(false)
  })

  it('does not reload twice for the same upload', () => {
    expect(shouldReload([transfer()], here, new Set(['t1'])).reload).toBe(false)
  })

  it('ignores an upload to another bucket', () => {
    expect(shouldReload([transfer({ bucket: 'elsewhere' })], here, new Set()).reload).toBe(false)
  })

  it('ignores an upload to an unrelated prefix', () => {
    expect(shouldReload([transfer({ key: 'invoices/q1.csv' })], here, new Set()).reload).toBe(false)
  })

  it('reloads for an upload into a subfolder, which appears as a new folder', () => {
    expect(shouldReload([transfer({ key: 'reports/2026/q1.csv' })], here, new Set()).reload).toBe(
      true
    )
  })

  it('ignores downloads', () => {
    expect(shouldReload([transfer({ kind: 'download' })], here, new Set()).reload).toBe(false)
  })

  it('ignores failed and cancelled uploads', () => {
    expect(shouldReload([transfer({ status: 'failed' })], here, new Set()).reload).toBe(false)
    expect(shouldReload([transfer({ status: 'cancelled' })], here, new Set()).reload).toBe(false)
  })

  it('does nothing at the bucket list, but still accounts for the upload', () => {
    const result = shouldReload([transfer()], null, new Set())
    expect(result.reload).toBe(false)
    expect(result.accounted).toContain('t1')
  })
})
