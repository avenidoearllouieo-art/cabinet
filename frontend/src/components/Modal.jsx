import { useEffect, useRef } from 'react'
import { ModalBody, ModalFooter, ModalHeader } from './ModalPrimitives.jsx'

export default function Modal({ isOpen, onClose, title, description, children, footer, dirty = false, busy = false, contentSized = false, drawer = false, maxWidth = '820px', containerClassName = '', headerIcon, headerActions, stepper, dialogRole = 'dialog', describedBy, closeLabel = 'Close dialog' }) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const dialogStateRef = useRef({ busy, dirty })
  const isTopmost = () => {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
    return dialogs.at(-1) === dialogRef.current
  }

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
      if (!isTopmost()) return
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
    <div role="presentation" className={`fixed inset-0 z-[var(--tt-layer-modal)] flex bg-[#071f41]/65 backdrop-blur-[2px] ${drawer ? 'justify-end p-0' : 'items-center justify-center p-2 sm:px-5 sm:py-4'}`} onMouseDown={(event) => event.target === event.currentTarget && isTopmost() && requestClose()} onClick={(event) => event.target === event.currentTarget && isTopmost() && requestClose()}>
      <div ref={dialogRef} tabIndex={-1} style={{ maxWidth }} className={`relative flex ${drawer ? 'h-full max-h-[100dvh] border-y-0 border-r-0 rounded-none' : contentSized ? 'h-auto max-h-[min(90vh,720px)]' : 'max-h-[92vh] max-h-[calc(100dvh-1rem)]'} w-full flex-col overflow-hidden border border-[#dbe5f0] bg-[#F3F6FA] shadow-[0_24px_80px_rgba(0,43,91,0.22)] ${drawer ? '' : 'rounded-xl sm:rounded-2xl'} ${containerClassName}`} role={dialogRole} aria-modal="true" aria-label={title} aria-describedby={describedBy}>
        <ModalHeader title={title} description={description} icon={headerIcon} actions={headerActions} onClose={requestClose} busy={busy} closeLabel={closeLabel} />
        {stepper}
        <ModalBody className={`${contentSized ? 'max-h-[calc(100dvh-10rem)] flex-none' : ''} px-4 py-4 sm:px-6 sm:py-6`}>{children}</ModalBody>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </div>
    </div>
  )
}
