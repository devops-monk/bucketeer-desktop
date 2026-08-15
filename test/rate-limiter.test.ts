import { pipeline } from 'node:stream/promises'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { RateLimiter, throttle } from '../src/main/app/rate-limiter'

/**
 * The bandwidth ceiling. Worth testing directly because both failure modes are quiet:
 * a limiter that does nothing silently ignores the setting, and one that deadlocks
 * stalls a transfer forever with no error.
 */

describe('RateLimiter', () => {
  it('does nothing when the limit is zero', async () => {
    const limiter = new RateLimiter(0)
    expect(limiter.enabled).toBe(false)

    const started = Date.now()
    await limiter.take(50 * 1024 * 1024)
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('slows a stream that exceeds the limit', async () => {
    // 100 KB/s against 50 KB of data: the first 100 KB is free from the initial bucket,
    // so send 150 KB and expect roughly half a second of waiting.
    const limiter = new RateLimiter(100 * 1024)
    const chunk = Buffer.alloc(10 * 1024)

    const source = Readable.from(Array.from({ length: 15 }, () => chunk))
    const sink = new Writable({ write: (_chunk, _encoding, callback) => callback() })

    const started = Date.now()
    await pipeline(source, throttle(limiter), sink)
    const elapsed = Date.now() - started

    expect(elapsed).toBeGreaterThan(300)
    // A limiter that stalls is worse than one that is slightly generous.
    expect(elapsed).toBeLessThan(3000)
  })

  it('lets a chunk larger than the whole budget through rather than deadlocking', async () => {
    const limiter = new RateLimiter(1024)

    const started = Date.now()
    await limiter.take(1024 * 1024)
    // It waits, but it does finish — never asking for more than a second's worth.
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('applies a new limit without being rebuilt', async () => {
    const limiter = new RateLimiter(1024)
    limiter.setLimit(0)

    expect(limiter.enabled).toBe(false)
    const started = Date.now()
    await limiter.take(10 * 1024 * 1024)
    expect(Date.now() - started).toBeLessThan(50)
  })
})
