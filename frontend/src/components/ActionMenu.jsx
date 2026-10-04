import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

export default function ActionMenu({ actions, label = 'More actions' }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const closeOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const toggleMenu = (event) => {
    event.stopPropagation()
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      const menuHeight = actions.length * 40 + 8
      setPosition({
        top: window.innerHeight - rect.bottom < menuHeight && rect.top > menuHeight ? rect.top - menuHeight : rect.bottom + 4,
        left: Math.max(8, rect.right - 176),
      })
    }
    setOpen((current) => !current)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={toggleMenu}
        className="instructor-more-button"
      >
        <MoreVertical size={17} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" className="instructor-action-menu" style={{ position: 'fixed', top: position.top, left: position.left }}>
          {actions.map(({ label: actionLabel, icon: Icon, onClick, danger }) => (
            <button
              key={actionLabel}
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                onClick()
              }}
              className={danger ? 'instructor-action-menu-item instructor-action-menu-danger' : 'instructor-action-menu-item'}
            >
              {Icon && <Icon size={15} aria-hidden="true" />}
              {actionLabel}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}