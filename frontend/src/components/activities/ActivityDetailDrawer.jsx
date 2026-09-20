import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'

const getAttachmentName = (attachment) => attachment?.filename || attachment?.file_name || attachment?.file || 'Attachment'
const getAttachmentSize = (attachment) => attachment?.size ?? attachment?.file_size ?? null
const getAttachmentUrl = (attachment) => attachment?.url || attachment?.download_url || attachment?.file || ''
import { X, FileText, Users, ClipboardList, CircleCheckBig, Download } from 'lucide-react'
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
    if (!activity) return undefined

    window.history.pushState({ activityDrawer: true }, '')
    const handlePopState = () => onClose?.()
    window.addEventListener('popstate', handlePopState)

    return () => window.removeEventListener('popstate', handlePopState)
  }, [activity, onClose])

  useEffect(() => {
    if (!activity?.id) return
    let active = true
    const timeoutId = window.setTimeout(() => {
      setLoading(true)
      setDetails(null)
      api.get(`/activities/${activity.id}/`)
        .then((res) => { if (active) setDetails(res.data) })
        .catch((err) => {
          console.error('Failed to load activity details', err)
          if (active) setDetails(activity)
        })
        .finally(() => { if (active) setLoading(false) })
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [activity])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const displayActivity = activity ? details || activity : null
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
    <div className="fixed inset-0 z-[9999] flex bg-[#071f41]/55 backdrop-blur-[2px]" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="flex-1" aria-hidden="true" />
      <aside className="relative z-10 flex w-full max-w-[600px] pointer-events-auto flex-col overflow-y-auto border-l border-[#dbe5f0] bg-[#f7f9fc] shadow-[-18px_0_50px_rgba(0,43,91,0.18)]" onMouseDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 z-[100] flex h-10 w-10 pointer-events-auto items-center justify-center rounded-xl border-2 border-[#f7c948] bg-[#ffc107] text-[#002b5b] shadow-md transition hover:bg-[#ffca2c] focus:outline-none focus:ring-2 focus:ring-[#ffc107]/70"
          aria-label="Close activity drawer"
        >
          <X size={20} strokeWidth={2.5} />
        </button>
        <div className="space-y-5 px-4 pb-6 pt-2 sm:px-6">
          <div className="sticky top-0 z-20 pointer-events-auto -mx-4 border-b border-[#dbe5f0] bg-[#f7f9fc]/95 px-4 pb-4 pt-2 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="rounded-2xl border border-[#dbe5f0] bg-white p-5 shadow-[0_8px_24px_rgba(25,55,89,0.06)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#64748b]">Activity Details</p>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#102a4c]">{displayActivity.title || 'Untitled Activity'}</h2>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge status={displayActivity.status || 'Published'} />
                <span className="inline-flex items-center gap-2 rounded-full bg-[#eef4fa] px-3 py-1 text-sm font-semibold text-[#28415f]">
                  <ClipboardList size={14} />
                  {displayActivity.activity_type || 'Assignment'}
                </span>
              </div>
            </div>
          </div>

          {loading && <p className="text-sm text-slate-500">Loading details…</p>}

          <div className="space-y-5">
            <div>
              <p className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[#64748b]">Activity Overview</p>
              <div className="grid gap-4 md:grid-cols-2">
                <DetailCard label="Description" value={displayActivity.description || 'No description provided.'} />
                <DetailCard label="Instructions" value={displayActivity.instructions || 'No instructions provided.'} />
              </div>
            </div>
            <div>
              <p className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[#64748b]">Assignment</p>
              <div className="grid gap-4 md:grid-cols-2">
                <DetailCard label="Assigned Instructor" value={assignedInstructor} />
                <DetailCard label="Due Date" value={formatDate(displayActivity.due_date)} />
                <DetailCard label="Assigned Sections" value={assignedSections.length ? assignedSections.join(', ') : 'Not assigned'} />
                <DetailCard label="Cabinet Station" value={displayActivity.cabinet_station || 'Not assigned'} />
              </div>
            </div>
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
                      <a href={getAttachmentUrl(attachment)} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#002B5B] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#123f73]">
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
