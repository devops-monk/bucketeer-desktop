import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ThemePreference } from '@shared/types'
import { api } from '../lib/api'
import { Tooltip } from './primitives'

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: ReactNode; hint: string }> = [
  {
    value: 'system',
    label: 'System',
    hint: 'Follow the operating system',
    icon: (
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <rect x="2.25" y="3.25" width="11.5" height="7.5" rx="1" />
        <path d="M5.5 13.25h5" strokeLinecap="round" />
      </svg>
    )
  },
  {
    value: 'light',
    label: 'Light',
    hint: 'Always light',
    icon: (
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <circle cx="8" cy="8" r="3" />
        <path
          d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.4 3.6l-1.05 1.05M4.65 11.35 3.6 12.4M12.4 12.4l-1.05-1.05M4.65 4.65 3.6 3.6"
          strokeLinecap="round"
        />
      </svg>
    )
  },
  {
    value: 'dark',
    label: 'Dark',
    hint: 'Always dark',
    icon: (
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path
          d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
]

/**
 * Light, dark, or whatever the machine is set to.
 *
 * Three states rather than a toggle, because "follow the system" is a real preference
 * and a two-way switch quietly overrides it the first time it is touched. The choice is
 * applied through Electron's themeSource, so native chrome changes with the window.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemePreference>('system')

  useEffect(() => {
    void api.app
      .getTheme()
      .then(setTheme)
      .catch(() => setTheme('system'))
  }, [])

  async function choose(next: ThemePreference) {
    setTheme(next)
    try {
      await api.app.setTheme(next)
    } catch {
      // A failed write is not worth interrupting anyone for; the theme still applied.
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = theme === option.value
        return (
          <Tooltip key={option.value} label={option.hint}>
            <button
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              onClick={() => void choose(option.value)}
              className={`flex h-5 w-6 items-center justify-center rounded-sm transition-colors duration-150 ${
                selected ? 'bg-raised text-accent-ink shadow-sm' : 'text-faint hover:text-muted'
              }`}
            >
              {option.icon}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
