import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export default function Modal({ isOpen, onClose, title, description, children, footer, dirty = false, busy = false, contentSized = false, maxWidth = '820px', containerClassName = '' }) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const dialogStateRef = useRef({ busy, dirty })

  useEffect(() => {
    onCloseRef.current = onClose
    dialogStateRef.current = { busy, dirty }
  }, [onClose, busy, dirty])

  const requestClose = () => {
    if (busy) return
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    onCloseRef.current?.()
  }

  useEffect(() => {
    if (!isOpen) return

    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusableSelector = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
    const focusFirst = () => {
      const firstFocusable = dialogRef.current?.querySelector(focusableSelector)
      ;(firstFocusable || dialogRef.current)?.focus({ preventScroll: true })
    }
    const focusTimer = window.setTimeout(focusFirst, 0)

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !dialogStateRef.current.busy) {
        if (!dialogStateRef.current.dirty || window.confirm('Discard your unsaved changes?')) onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...(dialogRef.current?.querySelectorAll(focusableSelector) || [])]
        .filter((element) => element.getClientRects().length)
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[var(--tt-layer-modal)] flex items-center justify-center bg-[#071f41]/65 p-2 backdrop-blur-[2px] sm:px-5 sm:py-4" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <div ref={dialogRef} tabIndex={-1} style={{ maxWidth }} className={`relative flex ${contentSized ? 'h-auto max-h-[min(90vh,720px)]' : 'max-h-[92vh] max-h-[calc(100dvh-1rem)]'} w-full flex-col overflow-hidden rounded-xl border border-[#dbe5f0] bg-[#f7f9fc] shadow-[0_24px_80px_rgba(0,43,91,0.22)] sm:rounded-2xl ${containerClassName}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-[#dbe5f0] border-l-4 border-l-[#ffc107] bg-[#eef4fa] px-3 py-3 backdrop-blur sm:gap-4 sm:px-7 sm:py-4">
          <div><h2 className="text-xl font-bold tracking-tight text-[#102a4c]">{title}</h2>{description && <p className="mt-1 text-sm text-[#64748b]">{description}</p>}</div>
          <button type="button" onClick={requestClose} disabled={busy} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#cbd8e6] bg-white text-[#28415f] transition hover:border-[#002B5B] hover:bg-[#f4f8fc] focus:outline-none focus:ring-2 focus:ring-[#FFC107]/70 disabled:opacity-50" aria-label="Close dialog"><X className="h-5 w-5" /></button>
        </header>
        <div className={`${contentSized ? 'max-h-[calc(100dvh-10rem)] flex-none' : 'min-h-0 flex-1'} overflow-y-auto px-3 py-4 sm:px-7 sm:py-6`}>{children}</div>
        {footer && <footer className="sticky bottom-0 z-10 border-t border-[#e1eaf3] bg-white px-3 py-3 sm:px-7">{footer}</footer>}
      </div>
    </div>
  )
}
