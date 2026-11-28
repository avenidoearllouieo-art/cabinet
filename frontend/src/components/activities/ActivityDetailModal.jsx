import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, ClipboardList, FileText, Users } from 'lucide-react'
import api from '../../services/api.js'
import AcademicFileAttachments from '../files/AcademicFileAttachments.jsx'
import Modal from '../Modal.jsx'
import StatusBadge from '../StatusBadge.jsx'
import { fetchAllResults } from '../../services/paginatedResults.js'

const formatDate = (value) => {
  if (!value) return 'No deadline'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
const formatTimestamp = (value) => {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const DetailValue = ({ label, children }) => (
  <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
    <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium text-slate-800">{children ?? 'Not recorded'}</dd>
  </div>
)

function DetailSection({ icon: Icon, title, children }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#082B53]"><Icon size={16} aria-hidden="true" />{title}</h3>
      {children}
    </section>
  )
}

export default function ActivityDetailModal({ activity, onClose }) {
  const [details, setDetails] = useState(activity || null)
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!activity?.id) return undefined
    let active = true
    const timeoutId = window.setTimeout(() => {
      setLoading(true)
      setLoadError('')
      Promise.allSettled([
        api.get(`/activities/${activity.id}/`),
        fetchAllResults(api, '/sections/'),
      ])
        .then(([activityResult, sectionResult]) => {
          if (!active) return
          if (activityResult.status === 'fulfilled') setDetails(activityResult.value.data)
          if (sectionResult.status === 'fulfilled') setSections(sectionResult.value.results)
          if (activityResult.status === 'rejected' || sectionResult.status === 'rejected') {
            setLoadError('Some activity details could not be loaded. The available record data is shown.')
          }
        })
        .finally(() => { if (active) setLoading(false) })
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [activity])

  const sectionNames = useMemo(() => {
    if (!details) return []
    const assignedSections = Array.isArray(details.assigned_sections) ? details.assigned_sections : []
    const source = assignedSections.length ? assignedSections : details.section ? [details.section] : []
    const lookup = new Map(sections.map((section) => [Number(section.id ?? section.section_id), section]))
    return source.map((item) => {
      if (item && typeof item === 'object') return item.section_name || item.name || item.subject_code || null
      const record = lookup.get(Number(item))
      return record?.section_name || record?.subject_code || null
    }).filter(Boolean)
  }, [details, sections])

  if (!activity) return null

  const displayActivity = details || activity
  const instructor = displayActivity.assigned_instructor_name
    || displayActivity.instructor_name
    || [displayActivity.created_by_name, displayActivity.created_by_last_name].filter(Boolean).join(' ')
  const assignedCount = displayActivity.assigned_student_count
  const submittedCount = displayActivity.submitted_students_count
  const status = String(displayActivity.status || 'Not recorded')
  return (
    <Modal
      isOpen={Boolean(activity)}
      onClose={onClose}
      title={displayActivity.title || 'Untitled Activity'}
      description={displayActivity.activity_type || 'Activity details'}
      headerIcon={<ClipboardList size={20} />}
      headerActions={<StatusBadge status={status} label={status} />}
      headerTitleClassName="line-clamp-2 max-w-[64ch] [overflow-wrap:anywhere]"
      headerDescriptionClassName="truncate"
      maxWidth="min(90vw, 1120px)"
      containerClassName="max-h-[calc(100dvh-1rem)]"
      closeLabel="Close activity details"
      footer={<div className="flex justify-end"><button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-[#082B53] hover:bg-slate-50">Close</button></div>}
    >
      <div className="space-y-6">
        {loading && <p className="text-sm text-slate-500" role="status">Loading activity details…</p>}
        {loadError && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">{loadError}</p>}

        <DetailSection icon={ClipboardList} title="Activity Overview">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailValue label="Activity type">{displayActivity.activity_type || 'Not recorded'}</DetailValue>
            <DetailValue label="Status"><StatusBadge status={status} label={status} /></DetailValue>
            <DetailValue label="Created">{formatTimestamp(displayActivity.created_at)}</DetailValue>
          </dl>
        </DetailSection>

        <DetailSection icon={FileText} title="Description and Instructions">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4"><h4 className="text-xs font-semibold uppercase text-slate-500">Description</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{displayActivity.description || 'No description provided'}</p></div>
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4"><h4 className="text-xs font-semibold uppercase text-slate-500">Instructions</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{displayActivity.instructions || 'No instructions provided'}</p></div>
          </div>
        </DetailSection>

        <DetailSection icon={Users} title="Instructor and Assigned Sections">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DetailValue label="Instructor">{instructor || 'Unassigned'}</DetailValue>
            <DetailValue label="Assigned Sections">{sectionNames.length ? sectionNames.join(', ') : 'No sections assigned'}</DetailValue>
          </dl>
        </DetailSection>

        <DetailSection icon={CalendarClock} title="Due Date and Maximum Score">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DetailValue label="Due date">{formatDate(displayActivity.due_date)}</DetailValue>
            <DetailValue label="Maximum score">{displayActivity.max_score ?? 'Not recorded'}</DetailValue>
          </dl>
        </DetailSection>


        <DetailSection icon={Users} title="Assigned Students and Submission Progress">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DetailValue label="Assigned students">{assignedCount ?? 'Not recorded'}</DetailValue>
            <DetailValue label="Submissions">{submittedCount === undefined || assignedCount === undefined ? 'Not recorded' : `${submittedCount} of ${assignedCount}`}</DetailValue>
          </dl>
        </DetailSection>

        <DetailSection icon={FileText} title="Attached Files">
          <AcademicFileAttachments attachments={displayActivity.attachments || []} kind="activity" emptyMessage="No activity files are attached." />
        </DetailSection>
      </div>
    </Modal>
  )
}