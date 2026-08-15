/**
 * Glob matching for include and exclude rules.
 *
 * Written rather than pulled in: the rules a sync needs are a small, well-understood
 * subset, and a matcher whose behaviour is written down here is worth more than one
 * whose edge cases live in someone else's changelog — this decides which files get
 * uploaded and which get skipped.
 *
 * Supported, matching what people expect from .gitignore and rsync:
 *   *      any run of characters except a slash
 *   **     any run of characters including slashes
 *   ?      exactly one character except a slash
 *   {a,b}  either alternative
 *   dir/   anything beneath that directory
 *
 * Patterns without a slash match the file name at any depth, so "*.tmp" excludes
 * temporary files wherever they sit — which is what someone typing it means.
 */

const SPECIAL = /[.+^$()|[\]\\]/g

function toRegExp(pattern: string): RegExp {
  const trailingSlash = pattern.endsWith('/')
  const body = trailingSlash ? pattern.slice(0, -1) : pattern
  // A bare name applies at any depth; a pattern with a slash is rooted at the sync root.
  const anchored = body.includes('/') ? body : `**/${body}`

  let source = ''
  for (let index = 0; index < anchored.length; index += 1) {
    const char = anchored[index]

    if (char === '*') {
      if (anchored[index + 1] === '*') {
        // "**/" should also match zero directories, so "**/x" matches a top-level "x".
        if (anchored[index + 2] === '/') {
          source += '(?:.*/)?'
          index += 2
          continue
        }
        source += '.*'
        index += 1
        continue
      }
      source += '[^/]*'
      continue
    }

    if (char === '?') {
      source += '[^/]'
      continue
    }

    if (char === '{') {
      const close = anchored.indexOf('}', index)
      if (close > index) {
        const options = anchored.slice(index + 1, close).split(',')
        source += `(?:${options.map((option) => option.replace(SPECIAL, '\\$&')).join('|')})`
        index = close
        continue
      }
    }

    source += char.replace(SPECIAL, '\\$&')
  }

  // A directory pattern covers everything inside it, not the directory entry itself.
  return new RegExp(`^${source}${trailingSlash ? '/.*' : ''}$`)
}

export interface Filters {
  /** When set, a path must match at least one of these to be included. */
  include?: string[]
  /** A path matching any of these is skipped, even if it matched an include. */
  exclude?: string[]
}

/**
 * Compiles filters once, so a sync of ten thousand files does not rebuild the same
 * regular expressions ten thousand times.
 */
export function compileFilters(filters: Filters): (relativePath: string) => boolean {
  const include = (filters.include ?? []).filter(Boolean).map(toRegExp)
  const exclude = (filters.exclude ?? []).filter(Boolean).map(toRegExp)

  return (relativePath: string): boolean => {
    if (exclude.some((pattern) => pattern.test(relativePath))) return false
    if (include.length === 0) return true
    return include.some((pattern) => pattern.test(relativePath))
  }
}
