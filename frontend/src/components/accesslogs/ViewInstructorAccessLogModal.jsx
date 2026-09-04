import { createPortal } from 'react-dom'

export default function ViewInstructorAccessLogModal({ isOpen, log, onClose }) {
  if (!isOpen || !log) return null

  const formatDate = (value) => {
    if (!value) return '—'
    try {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    } catch {
      return String(value)
    }
  }

  const statusColor = (status) => {
    if (!status) return 'text-slate-600'
    const lower = String(status).toLowerCase()
    if (lower === 'success') return 'text-green-600'
    if (lower === 'failed') return 'text-red-600'
    return 'text-slate-600'
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-[720px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label="View access log details">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">Cabinet Access Log Details</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Review the student and access information for this cabinet attempt.</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl font-bold text-[#475569] transition hover:text-[#0F172A]" aria-label="Close modal">
            ×
          </button>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] p-5">
            <h3 className="mb-3 text-sm font-semibold text-[#111827]">Student Information</h3>
            <div className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs font-medium text-slate-500">Student ID</p>
                <p className="mt-1 text-base text-slate-900">{log.student_id || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Full Name</p>
                <p className="mt-1 text-base text-slate-900">{log.student_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">RFID Number</p>
                <p className="mt-1 text-base text-slate-900">{log.rfid_tag || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Section</p>
                <p className="mt-1 text-base text-slate-900">{log.section_name || '—'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] p-5">
            <h3 className="mb-3 text-sm font-semibold text-[#111827]">Access Information</h3>
            <div className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs font-medium text-slate-500">Date</p>
                <p className="mt-1 text-base text-slate-900">{formatDate(log.access_time).split(',')[0] || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Time</p>
                <p className="mt-1 text-base text-slate-900">{formatDate(log.access_time).split(',')[1]?.trim() || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Cabinet Name</p>
                <p className="mt-1 text-base text-slate-900">{log.cabinet_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Access Result</p>
                <p className={`mt-1 text-base font-semibold ${statusColor(log.status)}`}>{log.status || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Reason</p>
                <p className="mt-1 text-base text-slate-900">{log.reason || '—'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
