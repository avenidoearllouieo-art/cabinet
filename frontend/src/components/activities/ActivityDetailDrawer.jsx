import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'

const getAttachmentName = (attachment) => attachment?.filename || attachment?.file_name || attachment?.file || 'Attachment'
const getAttachmentSize = (attachment) => attachment?.size ?? attachment?.file_size ?? null
const getAttachmentUrl = (attachment) => attachment?.url || attachment?.download_url || attachment?.file || ''
import { X, FileText, Users, ClipboardList, CalendarDays, CircleCheckBig, Download } from 'lucide-react'
import api from '../../services/api.js'

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

const formatBytes = (bytes) => {
  if (bytes == null) return '—'
  const kb = 1024
  if (bytes < kb) return `${bytes} B`
  const mb = kb * 1024
  if (bytes < mb) return `${(bytes / kb).toFixed(1)} KB`
  return `${(bytes / mb).toFixed(1)} MB`
}

const StatusBadge = ({ status }) => {
  const normalized = String(status || '').trim().toLowerCase()
  const badgeMap = {
    active: 'bg-emerald-100 text-emerald-700',
    scheduled: 'bg-amber-100 text-amber-700',
    draft: 'bg-sky-100 text-sky-700',
    archived: 'bg-slate-900 text-white',
    closed: 'bg-rose-100 text-rose-700',
    expired: 'bg-rose-100 text-rose-700',
    completed: 'bg-rose-100 text-rose-700',
  }
  const className = badgeMap[normalized] || 'bg-slate-100 text-slate-700'
  return <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${className}`}>{status || 'Unknown'}</span>
}

const DetailCard = ({ label, value, children }) => (
  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
    <p className="text-sm font-semibold text-slate-500">{label}</p>
    <div className="mt-2 text-sm text-slate-900">{value || children || '—'}</div>
  </div>
)

export default function ActivityDetailDrawer({ activity, onClose }) {
  const [details, setDetails] = useState(activity || null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activity?.id) return
    setLoading(true)
    setDetails(null)

    api.get(`/activities/${activity.id}/`)
      .then((res) => setDetails(res.data))
      .catch((err) => {
        console.error('Failed to load activity details', err)
        setDetails(activity)
      })
      .finally(() => setLoading(false))
  }, [activity?.id])

  const displayActivity = details || activity
  const assignedSections = useMemo(() => {
    if (!displayActivity) return []
    if (Array.isArray(displayActivity.assigned_sections)) {
      return displayActivity.assigned_sections
        .map((section) => (typeof section === 'object' ? section.section_name || section.name || 'Unnamed section' : section))
        .filter(Boolean)
    }
    return []
  }, [displayActivity])

  const assignedInstructor = displayActivity?.assigned_instructor_name || displayActivity?.assigned_instructor || displayActivity?.instructor_name || 'Unassigned'

  if (!displayActivity) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex bg-slate-950/40">
      <div className="flex-1" onClick={onClose} />
      <aside className="relative w-full max-w-[640px] overflow-y-auto bg-white p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-100"
          aria-label="Close activity drawer"
        >
          <X size={18} />
        </button>

        <div className="space-y-6 pt-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Activity Details</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{displayActivity.title || 'Untitled Activity'}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={displayActivity.status || 'Published'} />
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                <ClipboardList size={14} />
                {displayActivity.activity_type || 'Assignment'}
              </span>
            </div>
          </div>

          {loading && <p className="text-sm text-slate-500">Loading details…</p>}

          <div className="grid gap-4 md:grid-cols-2">
            <DetailCard label="Description" value={displayActivity.description || 'No description provided.'} />
            <DetailCard label="Instructions" value={displayActivity.instructions || 'No instructions provided.'} />
            <DetailCard label="Assigned Instructor" value={assignedInstructor} />
            <DetailCard label="Due Date" value={formatDate(displayActivity.due_date)} />
            <DetailCard label="Assigned Sections" value={assignedSections.length ? assignedSections.join(', ') : '—'} />
            <DetailCard label="Cabinet Station" value={displayActivity.cabinet_station || '—'} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-slate-500">
                <Users size={16} />
                <span className="text-sm font-semibold">Assigned Students</span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-900">{displayActivity.assigned_student_count ?? 0}</p>
            </div>
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-slate-500">
                <CircleCheckBig size={16} />
                <span className="text-sm font-semibold">Submission Progress</span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-900">{displayActivity.submitted_students_count ?? 0} / {displayActivity.assigned_student_count ?? 0}</p>
            </div>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-slate-700">
              <FileText size={16} />
              <span className="text-sm font-semibold">Attached Files</span>
            </div>
            <div className="mt-4 space-y-3">
              {displayActivity.attachments?.length ? (
                displayActivity.attachments.map((attachment) => (
                  <div key={attachment.id} className="flex flex-col gap-2 rounded-[12px] border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{getAttachmentName(attachment)}</p>
                      <p className="text-sm text-slate-500">{formatBytes(getAttachmentSize(attachment))}</p>
                    </div>
                    {getAttachmentUrl(attachment) && (
                      <a href={getAttachmentUrl(attachment)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
                        <Download size={16} /> Download
                      </a>
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-[12px] border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  No attachments available.
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
