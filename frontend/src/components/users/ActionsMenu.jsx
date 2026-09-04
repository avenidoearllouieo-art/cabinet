import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Eye, Edit2, Wifi, Key, UserMinus, Trash2 } from 'lucide-react'

export default function ActionsMenu({ user, onAction }) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState({ position: 'absolute', left: 0, top: 0, width: 220, zIndex: 9999 })
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const toggle = (e) => {
    e?.stopPropagation()
    setOpen((current) => {
      if (!current) {
        const rect = buttonRef.current?.getBoundingClientRect()
        if (rect) {
          const menuHeight = 240
          const scrollX = window.scrollX || window.pageXOffset
          const scrollY = window.scrollY || window.pageYOffset
          const openUp = window.innerHeight - rect.bottom < menuHeight && rect.top > menuHeight
          setMenuStyle({
            position: 'absolute',
            width: 220,
            zIndex: 9999,
            left: Math.max(8, rect.right - 220 + scrollX),
            top: openUp ? rect.top + scrollY - menuHeight - 8 : rect.bottom + scrollY + 8,
          })
        }
      }
      return !current
    })
  }

  const handle = (action, e) => {
    e?.stopPropagation()
    setOpen(false)
    onAction && onAction(action, user)
  }

  useEffect(() => {
    function onDocClick(e) {
      if (!open) return
      if (menuRef.current && menuRef.current.contains(e.target)) return
      if (buttonRef.current && buttonRef.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (!user) return null

  const menu = open ? (
    <div ref={menuRef} style={menuStyle} className="rounded-md border bg-white shadow-lg transition-all duration-200 ease-out" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-col p-1">
        <button type="button" style={{ pointerEvents: 'auto' }} className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={(e) => handle('view', e)}>
          <Eye size={16} />
          <span>View Profile</span>
        </button>

        <button type="button" style={{ pointerEvents: 'auto' }} className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={(e) => handle('edit', e)}>
          <Edit2 size={16} />
          <span>Edit User</span>
        </button>

        <button type="button" style={{ pointerEvents: 'auto' }} className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={(e) => handle('assign_nfc', e)}>
          <Wifi size={16} />
          <span>Assign / Change NFC UID</span>
        </button>

        <button type="button" style={{ pointerEvents: 'auto' }} className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={(e) => handle('reset_password', e)}>
          <Key size={16} />
          <span>Reset Password</span>
        </button>

        <div className="my-1 border-t border-transparent" />

        <button type="button" style={{ pointerEvents: 'auto' }} className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={(e) => {
          e.stopPropagation()
          const confirmMsg = user.is_active ? 'Are you sure you want to deactivate this account?' : 'Are you sure you want to activate this account?'
          if (!confirm(confirmMsg)) return
          handle(user.is_active ? 'deactivate' : 'activate', e)
        }}>
          <UserMinus size={16} />
          <span>Deactivate Account</span>
        </button>

        <div className="my-1 border-t border-transparent" />

        <button type="button" style={{ pointerEvents: 'auto' }} className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition" onClick={(e) => {
          e.stopPropagation()
          if (!confirm('Delete this account? This action cannot be undone.')) return
          handle('delete', e)
        }}>
          <Trash2 size={16} />
          <span className="font-medium">Delete Account</span>
        </button>
      </div>
    </div>
  ) : null

  return (
    <div className="inline-block text-left" style={{ position: 'relative', zIndex: 30 }}>
      <button ref={buttonRef} type="button" onClick={toggle} className="rounded-md bg-gray-100 px-3 py-1 text-sm">Actions</button>
      {open && createPortal(menu, document.body)}
    </div>
  )
}
