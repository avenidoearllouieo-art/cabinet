import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, Edit2, Copy, Layers, FileText, XCircle, Archive, Trash2 } from 'lucide-react'

export default function ActivityActionsMenu({ activity, onAction }) {
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
          const menuHeight = 330
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

  const handleClick = (action, e) => {
    e?.stopPropagation()
    setOpen(false)
    onAction && onAction(action, activity)
  }

  useEffect(() => {
    function handleDocumentClick(event) {
      if (!open) return
      if (menuRef.current?.contains(event.target)) return
      if (buttonRef.current?.contains(event.target)) return
      setOpen(false)
    }

    document.addEventListener('mousedown', handleDocumentClick)
    return () => document.removeEventListener('mousedown', handleDocumentClick)
  }, [open])

  const menu = (
    <div
      ref={menuRef}
      style={menuStyle}
      className="rounded-xl border border-slate-200 bg-white shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col p-1">
        <button
          type="button"
          style={{ pointerEvents: 'auto' }}
          className="flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          onClick={(e) => handleClick('view', e)}
        >
          <Eye size={16} />
          <span>View</span>
        </button>

        <button
          type="button"
          style={{ pointerEvents: 'auto' }}
          className="flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          onClick={(e) => handleClick('edit', e)}
        >
          <Edit2 size={16} />
          <span>Edit</span>
        </button>

        <button
          type="button"
          style={{ pointerEvents: 'auto' }}
          className="flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          onClick={(e) => handleClick('duplicate', e)}
        >
          <Copy size={16} />
          <span>Duplicate</span>
        </button>

        <button
          type="button"
          style={{ pointerEvents: 'auto' }}
          className="flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          onClick={(e) => handleClick('assign_sections', e)}
        >
          <Layers size={16} />
          <span>Assign Sections</span>
        </button>

        <button
          type="button"
          style={{ pointerEvents: 'auto' }}
          className="flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          onClick={(e) => handleClick('view_submissions', e)}
        >
          <FileText size={16} />
          <span>View Submissions</span>
        </button>

        <div className="my-1 h-px bg-slate-100" />

        <button
          type="button"
          style={{ pointerEvents: 'auto' }}
          className="flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          onClick={(e) => handleClick('close', e)}
        >
          <XCircle size={16} />
          <span>Close Activity</span>
        </button>

        <button
          type="button"
          style={{ pointerEvents: 'auto' }}
          className="flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          onClick={(e) => handleClick('archive', e)}
        >
          <Archive size={16} />
          <span>Archive</span>
        </button>

        <div className="my-1 h-px bg-slate-100" />

        <button
          type="button"
          style={{ pointerEvents: 'auto' }}
          className="flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50"
          onClick={(e) => handleClick('delete', e)}
        >
          <Trash2 size={16} />
          <span>Delete</span>
        </button>
      </div>
    </div>
  )

  return (
    <div className="inline-block text-left" style={{ position: 'relative', zIndex: 30 }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        Actions
      </button>
      {open && createPortal(menu, document.body)}
    </div>
  )
}
