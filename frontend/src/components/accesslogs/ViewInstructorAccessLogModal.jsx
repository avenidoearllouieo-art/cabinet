import Modal from '../Modal.jsx'
import { ShieldCheck } from 'lucide-react'
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

  return (
      <Modal
        isOpen={isOpen && Boolean(log)}
        onClose={onClose}
        title="Cabinet Access Log Details"
        description={`${accessLogValue(log.action)} event · Audit details for event ${accessLogValue(log.id)}.`}
        headerIcon={<ShieldCheck size={20} />}
        headerActions={result === 'Not recorded' ? <StatusBadge label={result} tone="neutral" /> : <StatusBadge status={result.toLowerCase()} label={result} />}
        maxWidth="760px"
      >
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
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-[#082B53] hover:bg-slate-50">Close</button>
        </div>
      </Modal>
  )
}
