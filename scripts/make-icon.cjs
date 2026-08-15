/**
 * Renders build/icon.svg to build/icon.png at 1024x1024.
 *
 * Rasterises with Electron's own Chromium, so generating the icon needs no image
 * library and no native dependency. electron-builder derives everything else from this
 * one file — the macOS .icns, the Windows .ico, and the Linux icon set — so a single
 * 1024px master is all the pipeline needs.
 *
 * Two Electron quirks shape this script, both found the hard way:
 *   - It is CommonJS because Electron never fires `ready` when an ESM file is passed as
 *     the entry script, so an .mjs version hangs forever on app.whenReady().
 *   - It renders exactly one window and does not resize the capture. Creating a second
 *     BrowserWindow, or resizing a captured nativeImage after its window is destroyed,
 *     kills the process with no error at all.
 *
 * Run with: npm run icon
 */
const { mkdir, readFile, writeFile, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { app, BrowserWindow, nativeImage, screen } = require('electron')

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const run = promisify(execFile)
const root = join(__dirname, '..')
const SIZE = 1024

/** The sizes an .iconset must contain, as {filename size} pairs. */
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

/**
 * Builds build/icon.icns with Apple's own tooling.
 *
 * electron-builder can convert a PNG to .icns on its own, but its converter writes
 * corrupt legacy 32px entries — which is precisely the size Finder and the Dock use in
 * list views, so the app shows a block of colour noise. sips and iconutil ship with
 * macOS and get it right, and electron-builder prefers an existing icon.icns over the
 * PNG, so simply producing this file takes its converter out of the path.
 */
async function buildIcns(master, scratch) {
  const iconset = join(scratch, 'icon.iconset')
  await mkdir(iconset, { recursive: true })

  for (const [name, size] of ICONSET) {
    await run('sips', ['-z', String(size), String(size), master, '--out', join(iconset, name)])
  }

  const target = join(root, 'build', 'icon.icns')
  await run('iconutil', ['-c', 'icns', iconset, '-o', target])
  console.log(`wrote ${target} — ${ICONSET.length} sizes, 16px to 1024px`)
}

app.whenReady().then(async () => {
  const scratch = join(tmpdir(), `bucketeer-icon-${process.pid}`)
  try {
    await mkdir(scratch, { recursive: true })
    const source = await readFile(join(root, 'build', 'icon.svg'), 'utf8')

    // capturePage returns physical pixels, so a window of SIZE/scaleFactor logical
    // pixels captures at exactly SIZE — no post-capture scaling required.
    const { scaleFactor } = screen.getPrimaryDisplay()
    const logical = Math.round(SIZE / scaleFactor)
    const svg = source.replace(/width="1024" height="1024"/, `width="${logical}" height="${logical}"`)

    const file = join(scratch, 'icon.html')
    await writeFile(file, `<html><body style="margin:0;background:transparent">${svg}</body></html>`)

    const window = new BrowserWindow({
      width: logical,
      height: logical,
      // Shown, not hidden: capturePage only returns frames the compositor has actually
      // painted, which hidden and offscreen-rendered windows never produce.
      show: true,
      x: 40,
      y: 40,
      frame: false,
      transparent: true,
      skipTaskbar: true
    })

    await window.loadFile(file)
    await new Promise((resolve) => setTimeout(resolve, 600))

    const png = (await window.webContents.capturePage()).toPNG()
    const { width } = nativeImage.createFromBuffer(png).getSize()
    if (width !== SIZE) {
      throw new Error(`Expected a ${SIZE}px render but got ${width}px.`)
    }

    const target = join(root, 'build', 'icon.png')
    await writeFile(target, png)
    console.log(`wrote ${target} — ${width}px, ${(png.length / 1024).toFixed(1)} kB`)

    if (process.platform === 'darwin') {
      await buildIcns(target, scratch)
    }
  } catch (error) {
    console.error('Icon generation failed:', error)
    await rm(scratch, { recursive: true, force: true })
    app.exit(1)
    return
  }
  await rm(scratch, { recursive: true, force: true })
  app.quit()
})
