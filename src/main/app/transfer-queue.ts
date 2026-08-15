/**
 * A minimal concurrency-limited task queue.
 *
 * Written rather than pulled in as a dependency because the requirement is a dozen
 * lines: run at most N tasks at once, in submission order, and never reject the caller
 * — a failed transfer is queue state the UI renders, not an exception someone must catch.
 */
export class TaskQueue {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly concurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1
      return
    }
    // Park until a slot frees up. Resolved in FIFO order, so transfers start in the
    // order the user queued them.
    await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active += 1
  }

  private release(): void {
    this.active -= 1
    this.waiting.shift()?.()
  }
}
