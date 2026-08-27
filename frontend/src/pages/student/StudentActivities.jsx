import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Search, ArrowRight, Plus, Clock, AlertCircle, CheckCircle2 } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import ActivityViewModal from '../../components/student/ActivityViewModal.jsx'
import ActivitySubmitModal from '../../components/student/ActivitySubmitModal.jsx'

const filterTabs = [
  { value: 'all', label: 'All Activities' },
  { value: 'pending', label: 'Pending' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_today', label: 'Due Today' },
  { value: 'closed', label: 'Closed' },
]

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return String(value)
  }
}

function shortDescription(value) {
  if (!value) return 'No description available.'
  return value.length > 90 ? `${value.slice(0, 90)}…` : value
}

function getSubmissionState(activity) {
  const status = String(activity?.student_submission_status || '').toLowerCase()
  const hasSubmission = Boolean(activity?.student_submitted_at) && !status.includes('not submitted')
  const dueDate = activity?.due_date ? new Date(activity.due_date) : null
  const now = new Date()
  const isPastDue = dueDate && dueDate < now

  if (hasSubmission) {
    if (status.includes('graded')) return 'submitted'
    if (isPastDue) return 'late'
    return 'submitted'
  }

  if (isPastDue) return 'overdue'
  if (dueDate && dueDate.toDateString() === now.toDateString()) return 'due_today'
  return 'pending'
}

function getBadgeClasses(state) {
  switch (state) {
    case 'submitted':
      return 'bg-emerald-50 text-emerald-700'
    case 'late':
      return 'bg-amber-50 text-amber-700'
    case 'overdue':
      return 'bg-rose-50 text-rose-700'
    case 'closed':
      return 'bg-slate-100 text-slate-700'
    case 'due_today':
      return 'bg-sky-50 text-sky-700'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

function getBadgeLabel(state) {
  switch (state) {
    case 'submitted':
      return 'Submitted'
    case 'late':
      return 'Late'
    case 'overdue':
      return 'Overdue'
    case 'closed':
      return 'Closed'
    case 'due_today':
      return 'Due Today'
    default:
      return 'Pending'
  }
}

function getActionLabel(state, canEdit) {
  if (state === 'pending' || state === 'due_today' || state === 'overdue') return 'Submit Activity'
  if (state === 'submitted' && canEdit) return 'Edit Submission'
  if (state === 'late' || state === 'closed') return 'View Submission'
  return 'View Submission'
}

function getCanEdit(activity) {
  const dueDate = activity?.due_date ? new Date(activity.due_date) : null
  const now = new Date()
  const isPastDue = dueDate && dueDate < now
  if (!activity?.student_submitted_at) return !isPastDue || Boolean(activity?.allow_resubmission)
  return !isPastDue || Boolean(activity?.allow_resubmission)
}

export default function StudentActivities() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [student, setStudent] = useState(null)
  const [stats, setStats] = useState({
    totalActivities: 0,
    pendingActivities: 0,
    submittedActivities: 0,
    overdueActivities: 0,
  })
  const [activities, setActivities] = useState([])
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [activeActivity, setActiveActivity] = useState(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false)

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      setError(null)
      try {
        let profile = null
        try {
          const resp = await api.get('/users/profile/')
          profile = resp.data
          try { localStorage.setItem('user', JSON.stringify(profile)) } catch {}
        } catch (e) {
          try { profile = JSON.parse(localStorage.getItem('user') || 'null') } catch { profile = null }
        }
        setStudent(profile)

        const sectionId = profile && (profile.section || profile.section_id || (profile.section && profile.section.section_id) || null)
        const sectionName = profile && (profile.section_name || (profile.section && profile.section.section_name) || null)
        if (!sectionId && !sectionName) {
          setError('Your account is not assigned to a section. Please contact your instructor.')
          setActivities([])
          setPageCount(0)
          setStats({ totalActivities: 0, pendingActivities: 0, submittedActivities: 0, overdueActivities: 0 })
          setLoading(false)
          return
        }

        await fetchStats(sectionId)
        await fetchActivities(sectionId)
      } catch (err) {
        console.error('Failed initializing student activities page:', err)
        setError('Failed to load your activities. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [query, page])

  useEffect(() => {
    setPage(1)
  }, [query, activeFilter])

  useEffect(() => {
    const handler = () => {
      let profile = null
      try { profile = JSON.parse(localStorage.getItem('user') || 'null') } catch { profile = null }
      const sectionId = (profile && profile.section) || (student && student.section) || null
      fetchActivities(sectionId)
      fetchStats(sectionId)
    }
    window.addEventListener('studentSubmissionSaved', handler)
    return () => window.removeEventListener('studentSubmissionSaved', handler)
  }, [student])

  const fetchStats = async (sectionId) => {
    try {
      const params = {}
      if (sectionId) params.section = sectionId
      const response = await api.get('/activities/stats/', { params })
      setStats(response.data)
    } catch (err) {
      console.error('Failed to load activity stats:', err)
      setError('Failed to load activity stats.')
    }
  }

  const fetchActivities = async (sectionId) => {
    setLoading(true)
    setError(null)
    try {
      const params = { search: query || undefined, page }
      if (sectionId) params.section = sectionId
      const response = await api.get('/activities/', { params })
      const fetchedActivities = response.data.results || []
      setPageCount(Math.ceil((response.data.count || 0) / (response.data.page_size || 10)))
      setActivities(fetchedActivities)
    } catch (err) {
      console.error('Failed to load activities:', err)
      setError('Failed to load activities. Please try again.')
      setActivities([])
    } finally {
      setLoading(false)
    }
  }

  const handleViewActivity = (activity) => {
    setActiveActivity(activity)
    setIsViewModalOpen(true)
  }

  const handleSubmitActivity = (activity) => {
    setActiveActivity(activity)
    setIsSubmitModalOpen(true)
  }

  const handleModalSuccess = () => {
    setIsSubmitModalOpen(false)
    setActiveActivity(null)
    const sectionId = (student && student.section) || (() => { try { const p = JSON.parse(localStorage.getItem('user') || 'null'); return p && p.section } catch { return null } })()
    fetchActivities(sectionId)
    fetchStats(sectionId)
  }

  const filteredActivities = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    let list = activities.filter((activity) => {
      const matchesQuery = !normalizedQuery || [activity.title, activity.instructor_name, activity.description].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
      return matchesQuery
    })

    const sorted = [...list].sort((left, right) => {
      const leftState = getSubmissionState(left)
      const rightState = getSubmissionState(right)
      const order = { pending: 0, submitted: 1, late: 2, overdue: 3, due_today: 4, closed: 5 }
      const stateDiff = (order[leftState] ?? 99) - (order[rightState] ?? 99)
      if (stateDiff !== 0) return stateDiff

      const leftSubmittedAt = left.student_submitted_at ? new Date(left.student_submitted_at).getTime() : 0
      const rightSubmittedAt = right.student_submitted_at ? new Date(right.student_submitted_at).getTime() : 0
      if (leftState === 'submitted' || leftState === 'late') {
        return rightSubmittedAt - leftSubmittedAt
      }
      return new Date(left.due_date || 0).getTime() - new Date(right.due_date || 0).getTime()
    })

    if (activeFilter === 'all') return sorted

    return sorted.filter((activity) => {
      const state = getSubmissionState(activity)
      if (activeFilter === 'pending') return state === 'pending' || state === 'due_today'
      if (activeFilter === 'submitted') return state === 'submitted' || state === 'late'
      if (activeFilter === 'overdue') return state === 'overdue'
      if (activeFilter === 'due_today') return state === 'due_today'
      if (activeFilter === 'closed') return state === 'closed' || state === 'late'
      return true
    })
  }, [activities, activeFilter, query])

  return (
    <div className="space-y-8">
      <PageHeader title="Student Activities" description="Review the activities assigned to your section and manage your submissions." />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<ClipboardList size={18} />} label="Total Activities" value={stats.totalActivities} subtitle="Activities assigned to your section" />
        <StatCard icon={<Search size={18} />} label="Pending Activities" value={stats.pendingActivities} subtitle="Not submitted yet" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Submitted Activities" value={stats.submittedActivities} subtitle="Activities you have submitted" />
        <StatCard icon={<AlertCircle size={18} />} label="Overdue Activities" value={stats.overdueActivities} subtitle="Past due without submission" />
      </div>

      <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex w-full items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm focus-within:border-transparent focus-within:ring-2 focus-within:ring-blue-900">
              <Search size={16} className="text-slate-500" />
              <input
                type="text"
                placeholder="Search title or instructor"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="ml-3 min-w-[240px] bg-transparent text-sm text-slate-900 outline-none"
              />
            </div>
          </div>
          <div className="text-sm text-slate-500">Showing {filteredActivities.length} of {activities.length} activities</div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveFilter(tab.value)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${activeFilter === tab.value ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="p-6 text-sm text-rose-700">{error}</div>
        ) : loading ? (
          <div className="p-6 text-sm text-slate-500">Loading activities…</div>
        ) : filteredActivities.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50 p-8 text-sm text-slate-600">No activities match this view right now.</div>
        ) : (
          <div className="space-y-4">
            {filteredActivities.map((activity) => {
              const state = getSubmissionState(activity)
              const canEdit = getCanEdit(activity)
              const actionLabel = getActionLabel(state, canEdit)
              return (
                <div key={activity.id} className="rounded-[20px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-900">{activity.title}</h3>
                        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${getBadgeClasses(state)}`}>
                          {state === 'submitted' && <CheckCircle2 size={12} />}
                          {state === 'late' && <Clock size={12} />}
                          {state === 'overdue' && <AlertCircle size={12} />}
                          {getBadgeLabel(state)}
                        </span>
                        {activity.student_submitted_at ? (
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">Submitted {formatDate(activity.student_submitted_at)}</span>
                        ) : null}
                      </div>
                      <p className="text-sm leading-7 text-slate-600">{shortDescription(activity.description)}</p>
                      <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                        <span>Instructor: {activity.instructor_name || '—'}</span>
                        <span>Due: {formatDate(activity.due_date)}</span>
                        <span>Max score: {activity.max_score ?? '—'}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => handleViewActivity(activity)} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                        <ArrowRight size={14} /> View Details
                      </button>
                      <button type="button" onClick={() => handleSubmitActivity(activity)} className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">
                        {actionLabel}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ActivityViewModal activity={activeActivity} isOpen={isViewModalOpen} onClose={() => { setIsViewModalOpen(false); setActiveActivity(null) }} />

      <ActivitySubmitModal activity={activeActivity} isOpen={isSubmitModalOpen} onClose={() => { setIsSubmitModalOpen(false); setActiveActivity(null) }} onSuccess={handleModalSuccess} />
    </div>
  )
}
