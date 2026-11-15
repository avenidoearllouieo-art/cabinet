import { useEffect, useMemo, useState } from 'react'
import { FileText, Users, ClipboardList, CircleCheckBig } from 'lucide-react'
import api from '../../services/api.js'
import AcademicFileAttachments from '../files/AcademicFileAttachments.jsx'
import Modal from '../Modal.jsx'


const formatDate = (value) => {
  if (!value) return 'No deadline'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No deadline'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return String(value)
  }
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

  return (
      <Modal
        isOpen={Boolean(displayActivity)}
        onClose={onClose}
        title={displayActivity.title || 'Untitled Activity'}
        description={`${displayActivity.activity_type || 'Assignment'} · ${assignedSections.length ? assignedSections.join(', ') : 'No sections assigned'}`}
        headerIcon={<ClipboardList size={20} />}
        headerActions={<StatusBadge status={displayActivity.status || 'Published'} />}
        drawer
        maxWidth="min(100vw, 600px)"
        closeLabel="Close activity details"
      >
        <div className="space-y-5">

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
                <DetailCard label="Maximum Score" value={displayActivity.max_score ?? '—'} />
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
            <div className="mt-4"><AcademicFileAttachments attachments={displayActivity.attachments || []} kind="activity" /></div>
          </div>
        </div>
      </Modal>
  )
}
