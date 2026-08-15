import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** Shown greyed with the reason, rather than hidden — a menu that reflows is worse. */
  disabledReason?: string
  danger?: boolean
  /** Draws a separator above this item. */
  separated?: boolean
}

/**
 * The right-click menu for a row.
 *
 * Everything here is also in the toolbar: the menu is a shortcut for people who reach
 * for it, never the only way to do something. Items that do not apply are disabled with
 * the reason rather than removed, so the menu keeps the same shape and nothing moves
 * under the pointer.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // Nudged back inside the window if opening near an edge would clip it.
  useLayoutEffect(() => {
    const element = menu.current
    if (!element) return

    const { width, height } = element.getBoundingClientRect()
    setPosition({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const dismiss = () => onClose()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    // Any click anywhere closes it, including one that lands on another row.
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={menu}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
      style={{ left: position.left, top: position.top }}
      className="fixed z-[70] min-w-52 rounded-md border border-line bg-raised py-1 shadow-lg"
    >
      {items.map((item, index) => (
        <div key={item.label}>
          {item.separated && index > 0 ? <div className="my-1 h-px bg-line-soft" /> : null}
          <button
            role="menuitem"
            disabled={Boolean(item.disabledReason)}
            title={item.disabledReason}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] transition-colors disabled:opacity-40 ${
              item.danger ? 'text-danger hover:bg-danger/10' : 'text-text hover:bg-hover'
            } disabled:hover:bg-transparent`}
          >
            <span className="w-4 shrink-0 text-faint">{item.icon}</span>
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
