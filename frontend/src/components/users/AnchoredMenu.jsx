import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function AnchoredMenu({ open, onOpenChange, renderTrigger, children, ariaLabel, align = 'end', menuClassName = '' }) {
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const restoreFocusRef = useRef(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return

    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = window.innerHeight
    const menuWidth = Math.min(menuRect.width || 240, viewportWidth - 16)
    const menuHeight = Math.min(menuRect.height || 240, viewportHeight - 16)
    const left = align === 'start' ? triggerRect.left : triggerRect.right - menuWidth
    const opensAbove = triggerRect.bottom + menuHeight + 8 > viewportHeight && triggerRect.top - menuHeight - 8 >= 8

    setPosition({
      left: Math.max(8, Math.min(left, viewportWidth - menuWidth - 8)),
      top: opensAbove
        ? Math.max(8, triggerRect.top - menuHeight - 8)
        : Math.max(8, Math.min(triggerRect.bottom + 8, viewportHeight - menuHeight - 8)),
    })
  }, [align])

  const closeMenu = useCallback((restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus
    onOpenChange(false)
  }, [onOpenChange])

  useLayoutEffect(() => {
    if (!open) return undefined

    const triggerElement = triggerRef.current
    updatePosition()
    menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus()

    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return
      closeMenu(false)
    }
    const handleKeyDown = (event) => {
      const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
      const currentIndex = items.indexOf(document.activeElement)

      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu(true)
      } else if (items.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const nextIndex = event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1
            : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[nextIndex]?.focus()
      } else if (event.key === 'Tab') {
        closeMenu(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      if (restoreFocusRef.current) triggerElement?.focus()
      restoreFocusRef.current = false
    }
  }, [open, closeMenu, updatePosition])

  return (
    <>
      {renderTrigger({
        ref: triggerRef,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: (event) => {
          event.stopPropagation()
          onOpenChange(!open)
        },
      })}
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          className={`fixed z-[var(--tt-layer-popover)] max-h-[calc(100dvh-16px)] w-60 overflow-y-auto rounded-lg border border-[#dbe5f0] bg-white p-1.5 shadow-[0_12px_28px_rgba(0,43,91,0.18)] ${menuClassName}`}
          style={{ left: position.left, top: position.top }}
          onClick={(event) => {
            if (event.target.closest?.('[role="menuitem"]') && !event.target.closest('[role="menuitem"]')?.disabled) closeMenu(true)
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}