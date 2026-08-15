import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  test: {
    // Node, not jsdom: these cover the main process, which is where every S3 call lives.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Stubs the preload bridge so renderer logic can be tested without a window.
    setupFiles: ['test/setup.ts'],
    // Transfers involve real sockets and real files; the default 5s is tight for a slow
    // machine, and a flaky suite gets ignored.
    testTimeout: 20000
  }
})
