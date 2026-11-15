import { useId } from 'react'
import { AlertCircle } from 'lucide-react'
import Modal from './Modal.jsx'

export default function ConfirmationDialog({
  isOpen,
  title,
  description,
  message,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busyLabel = 'Working...',
  busy = false,
  confirmDisabled = false,
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const messageId = useId()
  return (
    <Modal
      isOpen={isOpen}
      title={title}
      description={description}
      headerIcon={<AlertCircle size={20} />}
      dialogRole="alertdialog"
      describedBy={messageId}
      onClose={onCancel}
      busy={busy}
      maxWidth="min(100%, 520px)"
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-[#082B53] hover:bg-slate-50 disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={`min-h-11 rounded-lg px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${destructive ? 'bg-rose-700 hover:bg-rose-800' : 'bg-[#082B53] hover:bg-[#103d70]'}`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      )}
    >
      <div id={messageId} className="text-sm leading-6 text-slate-700">
        {children || message || 'Are you sure you want to continue?'}
      </div>
    </Modal>
  )
}