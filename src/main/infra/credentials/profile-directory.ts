import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProfileDirectory } from '../../core/ports'

const SECTION = /^\s*\[\s*(?:profile\s+)?([^\]]+?)\s*\]\s*$/

/**
 * Reads profile names straight out of the AWS shared config files.
 *
 * Parsed here rather than through the SDK's loader on purpose: the picker should still
 * list a profile whose SSO session has expired or whose body is malformed, since those
 * are exactly the profiles a user needs to select in order to fix them.
 */
export class SharedConfigProfileDirectory implements ProfileDirectory {
  async listProfiles(): Promise<string[]> {
    const files = [
      process.env.AWS_CONFIG_FILE ?? join(homedir(), '.aws', 'config'),
      process.env.AWS_SHARED_CREDENTIALS_FILE ?? join(homedir(), '.aws', 'credentials')
    ]

    const names = new Set<string>()
    for (const file of files) {
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue // Having no AWS config at all is normal, not a failure.
      }
      for (const line of text.split('\n')) {
        const match = SECTION.exec(line)
        // sso-session blocks are referenced by profiles; they aren't selectable themselves.
        if (match && !match[1].startsWith('sso-session')) names.add(match[1])
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }
}
