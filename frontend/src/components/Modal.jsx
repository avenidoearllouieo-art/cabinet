import { useEffect } from 'react'

export default function Modal({ isOpen, onClose, title, children }) {
  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6">
      <div className="relative w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-[16px] border border-[#E5E7EB] bg-white p-8 shadow-sm" role="dialog" aria-modal="true">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#111827]">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-[#6B7280] hover:bg-[#F3F4F6]" aria-label="Close dialog">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  )
}
