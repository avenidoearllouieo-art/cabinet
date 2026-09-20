import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ isOpen, onClose, title, description, children, footer, dirty = false, busy = false, containerClassName = '' }) {
  const requestClose = () => {
    if (busy) return
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    onClose?.()
  }

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        if (!dirty || window.confirm('Discard your unsaved changes?')) onClose?.()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, busy, dirty, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 px-3 py-4 sm:px-4" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <div className={`relative flex max-h-[94vh] w-full max-w-[700px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-2xl ${containerClassName}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sticky top-0 z-10 mt-0 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div><h2 className="text-xl font-bold text-[#0B1F3A]">{title}</h2>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}</div>
          <button type="button" onClick={requestClose} disabled={busy} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#002B5B]/20 text-[#002B5B] hover:bg-[#002B5B]/5 focus:outline-none focus:ring-2 focus:ring-[#002B5B]/30 disabled:opacity-50" aria-label="Close dialog"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {footer && <footer className="sticky bottom-0 z-10 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">{footer}</footer>}
      </div>
    </div>
  )
}
