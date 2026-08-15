import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProfileDirectory, SsoSettings } from '../../core/ports'

const SECTION = /^\s*\[\s*([^\]]+?)\s*\]\s*$/

interface Section {
  header: string
  values: Record<string, string>
}

/**
 * Reads the AWS shared config files.
 *
 * Parsed here rather than through the SDK's loader on purpose: the picker should still
 * list a profile whose SSO session has expired or whose body is malformed, since those
 * are exactly the profiles a user needs to select in order to fix them.
 */
export class SharedConfigProfileDirectory implements ProfileDirectory {
  async listProfiles(): Promise<string[]> {
    const sections = await this.read()
    const names = sections
      .map((section) => section.header)
      // sso-session blocks are referenced by profiles; they aren't selectable themselves.
      .filter((header) => !header.startsWith('sso-session'))
      .map((header) => header.replace(/^profile\s+/, ''))

    return [...new Set(names)].sort((a, b) => a.localeCompare(b))
  }

  /**
   * The SSO settings a profile logs in with, resolving both layouts: the legacy one
   * that inlines sso_start_url on the profile, and the sso_session form that points at
   * a shared block. They differ in how the token cache is keyed, so which one was used
   * has to survive this lookup.
   */
  async readSsoSettings(profileName: string): Promise<SsoSettings | null> {
    const sections = await this.read()
    const profile = sections.find(
      (section) => section.header === `profile ${profileName}` || section.header === profileName
    )
    if (!profile) return null

    const sessionName = profile.values.sso_session
    if (sessionName) {
      const session = sections.find((section) => section.header === `sso-session ${sessionName}`)
      if (!session?.values.sso_start_url) return null
      return {
        startUrl: session.values.sso_start_url,
        region: session.values.sso_region ?? profile.values.region ?? 'us-east-1',
        // The cache is keyed on the session name in this layout, not the start URL.
        sessionName
      }
    }

    if (!profile.values.sso_start_url) return null
    return {
      startUrl: profile.values.sso_start_url,
      region: profile.values.sso_region ?? profile.values.region ?? 'us-east-1'
    }
  }

  private async read(): Promise<Section[]> {
    const files = [
      process.env.AWS_CONFIG_FILE ?? join(homedir(), '.aws', 'config'),
      process.env.AWS_SHARED_CREDENTIALS_FILE ?? join(homedir(), '.aws', 'credentials')
    ]

    const sections: Section[] = []
    for (const file of files) {
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue // Having no AWS config at all is normal, not a failure.
      }

      let current: Section | null = null
      for (const rawLine of text.split('\n')) {
        const line = rawLine.split(/[#;]/)[0].trimEnd()
        const match = SECTION.exec(line)
        if (match) {
          current = { header: match[1], values: {} }
          sections.push(current)
          continue
        }
        if (!current) continue

        const separator = line.indexOf('=')
        if (separator > 0) {
          current.values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
        }
      }
    }
    return sections
  }
}
