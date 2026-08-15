import { shell } from 'electron'
import type { UrlOpener } from '../core/ports'

/** Opens URLs in the user's default browser, which is where a login belongs. */
export class ShellUrlOpener implements UrlOpener {
  async open(url: string): Promise<void> {
    await shell.openExternal(url)
  }
}
