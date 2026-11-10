import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import StatusBadge from '../StatusBadge.jsx'
import { accessLogResult, accessLogValue, formatAccessLogDate, formatAccessLogTime } from './accessLogFormatters.js'
import AccessLogPhotoPanel from './AccessLogPhotoPanel.jsx'

const DetailField = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-xs font-medium text-slate-500">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium text-[#102a4c]">{children}</dd>
  </div>
)

export default function ViewInstructorAccessLogModal({ isOpen, log, onClose, allowPhotoPreview = false }) {
  if (!isOpen || !log) return null
  const result = accessLogResult(log)

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-[#071f41]/55 p-4 backdrop-blur-[2px]">
      <div className="max-h-[90vh] w-full max-w-[760px] overflow-y-auto rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-xl sm:p-6" role="dialog" aria-modal="true" aria-label="Cabinet Access Log Details">
        <div className="mb-5 flex items-start justify-between gap-4 rounded-lg border-l-4 border-[#ffc107] bg-[#eef4fa] p-4 sm:p-5">
          <div>
            <p className="text-xs font-bold uppercase text-[#526780]">{accessLogValue(log.action)} event</p>
            <h2 className="mt-1 text-xl font-bold text-[#102a4c]">Cabinet Access Log Details</h2>
            <p className="mt-1 text-sm text-[#526780]">Audit details for event {accessLogValue(log.id)}.</p>
            <div className="mt-2">{result === 'Not recorded' ? <StatusBadge label={result} tone="neutral" /> : <StatusBadge status={result.toLowerCase()} label={result} />}</div>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#dbe5f0] bg-white text-[#526780] transition hover:bg-[#f3f6fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc107]" aria-label="Close modal">
            <X size={17} />
          </button>
        </div>

        <div className="space-y-5">
          <section className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#102a4c]">Access Event</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Event ID">{accessLogValue(log.id)}</DetailField>
              <DetailField label="Access Result">
                {result === 'Not recorded' ? result : <StatusBadge status={result.toLowerCase()} label={result} />}
              </DetailField>
              <DetailField label="Date">{formatAccessLogDate(log.access_time)}</DetailField>
              <DetailField label="Time">{formatAccessLogTime(log.access_time)}</DetailField>
              <DetailField label="Failure / Denial Reason">
                {result === 'Success' ? 'Not applicable' : accessLogValue(log.reason)}
              </DetailField>
            </dl>
          </section>

          <section className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#102a4c]">Student Information</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Student ID">{accessLogValue(log.student_id)}</DetailField>
              <DetailField label="Full Name">{accessLogValue(log.student_name)}</DetailField>
              <DetailField label="Section">{accessLogValue(log.section_name)}</DetailField>
              <DetailField label="Access Type">{accessLogValue(log.access_type)}</DetailField>
            </dl>
          </section>

          <section className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#102a4c]">Cabinet Information</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Cabinet Name">{accessLogValue(log.cabinet_name)}</DetailField>
              <DetailField label="Reader / Station">{accessLogValue(log.station)}</DetailField>
            </dl>
          </section>

          <AccessLogPhotoPanel
            eventId={log.id}
            captureStatus={log.photo_capture_status}
            allowImage={allowPhotoPreview}
          />
        </div>

        <div className="mt-5 flex justify-end border-t border-[#dbe5f0] pt-4">
          <button type="button" onClick={onClose} className="tt-button tt-button-secondary">Close</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
