import { Transform } from 'node:stream'

/**
 * A shared ceiling on how fast bytes move, across every transfer at once.
 *
 * Shared on purpose: limiting each transfer separately means three concurrent uploads
 * use three times the limit, which is not what anyone means by "cap this at 5 MB/s".
 *
 * Implemented as a token bucket refilled continuously rather than a fixed window, so a
 * transfer is slowed smoothly instead of stopping dead at the top of each second.
 */
export class RateLimiter {
  private tokens: number
  private lastRefill = Date.now()

  constructor(private bytesPerSecond: number) {
    // Start with a second's worth so a small transfer is not delayed for no reason.
    this.tokens = bytesPerSecond
  }

  /** Zero disables the limit entirely, which is the default. */
  get enabled(): boolean {
    return this.bytesPerSecond > 0
  }

  setLimit(bytesPerSecond: number): void {
    this.bytesPerSecond = bytesPerSecond
    this.tokens = Math.min(this.tokens, bytesPerSecond)
  }

  /** Resolves once this many bytes may be sent. */
  async take(bytes: number): Promise<void> {
    if (!this.enabled) return

    // A chunk larger than the per-second budget would never be affordable, so it is
    // allowed through after one full refill rather than deadlocking.
    const wanted = Math.min(bytes, this.bytesPerSecond)

    for (;;) {
      this.refill()
      if (this.tokens >= wanted) {
        this.tokens -= wanted
        return
      }

      const shortfall = wanted - this.tokens
      const waitMs = Math.ceil((shortfall / this.bytesPerSecond) * 1000)
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 5)))
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.lastRefill = now
    this.tokens = Math.min(this.bytesPerSecond, this.tokens + elapsed * this.bytesPerSecond)
  }
}

/**
 * A stream that passes bytes through no faster than the limiter allows.
 *
 * Back-pressure does the work: holding the callback stops the source reading, which for
 * an upload stops the file being read and for a download stops the socket draining.
 */
export function throttle(limiter: RateLimiter): Transform {
  return new Transform({
    async transform(chunk: Buffer, _encoding, callback) {
      try {
        await limiter.take(chunk.length)
        callback(null, chunk)
      } catch (error) {
        callback(error as Error)
      }
    }
  })
}
