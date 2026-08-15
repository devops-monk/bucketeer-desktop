/**
 * Renderer modules read the preload bridge at import time, which does not exist outside
 * Electron. This stub lets pure renderer logic — sorting, filtering, refresh rules — be
 * tested in plain Node without booting a window.
 */
const bridge = new Proxy(
  {},
  {
    get: () =>
      new Proxy(function () {}, {
        get: () => () => {},
        apply: () => undefined
      })
  }
)

Object.defineProperty(globalThis, 'window', {
  value: { bucketeer: bridge, platform: 'darwin', pathForFile: () => '' },
  writable: true,
  configurable: true
})
