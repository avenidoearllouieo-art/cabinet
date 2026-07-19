import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, Edit2, Copy, Layers, FileText, XCircle, Archive, Trash2 } from 'lucide-react'

export default function ActivityActionsMenu({ activity, onAction }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const toggle = (e) => {
    e?.stopPropagation()
    setOpen((current) => !current)
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

  const getMenuStyle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    const MENU_WIDTH = 220
    const MENU_HEIGHT = 330
    const style = {
      position: 'absolute',
      width: MENU_WIDTH,
      zIndex: 9999,
    }

    if (!rect) {
      style.left = 0
      style.top = 0
      return style
    }

    const scrollX = window.scrollX || window.pageXOffset
    const scrollY = window.scrollY || window.pageYOffset
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < MENU_HEIGHT && rect.top > MENU_HEIGHT

    style.left = Math.max(8, rect.right - MENU_WIDTH + scrollX)
    style.top = openUp ? rect.top + scrollY - MENU_HEIGHT - 8 : rect.bottom + scrollY + 8
    return style
  }

  const menu = (
    <div
      ref={menuRef}
      style={getMenuStyle()}
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
