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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#071f41]/65 px-3 py-4 backdrop-blur-[2px] sm:px-5" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <div className={`relative flex max-h-[92vh] w-full max-w-[820px] flex-col overflow-hidden rounded-2xl border border-[#dbe5f0] bg-[#f7f9fc] shadow-[0_24px_80px_rgba(0,43,91,0.22)] ${containerClassName}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#e1eaf3] bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
          <div><h2 className="text-xl font-bold tracking-tight text-[#102a4c]">{title}</h2>{description && <p className="mt-1 text-sm text-[#64748b]">{description}</p>}</div>
          <button type="button" onClick={requestClose} disabled={busy} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#cbd8e6] bg-white text-[#28415f] transition hover:border-[#002B5B] hover:bg-[#f4f8fc] focus:outline-none focus:ring-2 focus:ring-[#FFC107]/70 disabled:opacity-50" aria-label="Close dialog"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">{children}</div>
        {footer && <footer className="sticky bottom-0 z-10 border-t border-[#e1eaf3] bg-white px-4 py-3 sm:px-7">{footer}</footer>}
      </div>
    </div>
  )
}
