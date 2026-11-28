import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Send, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import api from '../../services/api.js'
import { fetchAllResults } from '../../services/paginatedResults.js'
import PageHeader from '../../components/PageHeader'
import SearchField from '../../components/SearchField.jsx'
import SummaryCard from '../../components/SummaryCard'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/StatusBadge'
import Pagination from '../../components/Pagination.jsx'
import ExpandedDetailsGrid from '../../components/ExpandedDetailsGrid.jsx'
import SubmissionActionsMenu from '../../components/submissions/SubmissionActionsMenu.jsx'
import ViewSubmissionModal from '../../components/submissions/ViewSubmissionModal.jsx'
import { pluralize } from '../../utils/labels.js'

const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'late', label: 'Late' },
  { value: 'graded', label: 'Graded' },
]

const PAGE_SIZE = 10

const formatDate = (value) => {
  if (!value) return 'No date recorded'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

const resolveActivityType = (submission) => {
  return submission.activity_type || submission.activity?.activity_type || submission.activity?.type || '—'
}

const resolveStatus = (submission) => {
  const raw = submission.status ? String(submission.status).toLowerCase() : null
  if (['graded', 'late', 'submitted'].includes(raw)) return raw

  const dueDate = submission.activity?.due_date
  const submittedAt = submission.submitted_at
  if (submittedAt && dueDate) {
    try {
      if (new Date(submittedAt) > new Date(dueDate)) return 'late'
    } catch {
      // Invalid dates fall through to the remaining status checks.
    }
  }

  if (submission.score != null) return 'graded'
  return 'submitted'
}

const resolveInstructor = (submission) => {
  const explicit = submission.instructor_name || submission.activity?.instructor_name || submission.activity?.assigned_instructor_name
  if (explicit) return explicit

  const assignedInstructor = submission.activity?.assigned_instructor || submission.activity?.assignedInstructor
  if (assignedInstructor) {
    const fullName = `${assignedInstructor.first_name || ''} ${assignedInstructor.last_name || ''}`.trim()
    return fullName || assignedInstructor.username || assignedInstructor.email || '—'
  }

  return '—'
}

export default function Submissions() {
  const navigate = useNavigate()
  const location = useLocation()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [activityIdFilter, setActivityIdFilter] = useState(() => {
    const params = new URLSearchParams(location.search)
    return params.get('activity') || ''
  })
  const [statusFilter, setStatusFilter] = useState('')
  const [submittedDate, setSubmittedDate] = useState('')
  const [activityOptions, setActivityOptions] = useState([])
  const [stats, setStats] = useState({ total: 0, pending: 0, graded: 0, late: 0 })
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null)
  const [isViewOpen, setIsViewOpen] = useState(false)

  const fetchSubmissions = useCallback(async (signal) => {
    try {
      setLoading(true)
      const params = { page, ordering: '-submitted_at' }
      if (query.trim()) params.search = query.trim()
      if (activityIdFilter) params.activity = activityIdFilter
      if (statusFilter) params.status = statusFilter
      if (submittedDate) params.submission_date = submittedDate
      const response = await api.get('/submissions/', { params, signal })
      if (signal?.aborted) return
      const rawData = Array.isArray(response.data) ? response.data : response.data.results || []
      setSubmissions(rawData)
      const count = Array.isArray(response.data) ? rawData.length : Number(response.data.count || 0)
      setTotalCount(count)
      setPageCount(Math.max(1, Math.ceil(count / PAGE_SIZE)))
      setError('')
    } catch (err) {
      if (!signal?.aborted) {
        console.error('Error fetching submissions:', err)
        setError('Failed to load submissions.')
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [activityIdFilter, page, query, statusFilter, submittedDate])

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => fetchSubmissions(controller.signal), 0)
    return () => { window.clearTimeout(timeoutId); controller.abort() }
  }, [fetchSubmissions])

  useEffect(() => {
    let active = true
    Promise.all([
      api.get('/submissions/stats/'),
      fetchAllResults(api, '/activities/'),
    ]).then(([statsResponse, activitiesResponse]) => {
      if (!active) return
      const data = statsResponse.data || {}
      setStats({ total: Number(data.totalSubmissions || 0), pending: Number(data.pendingReview || 0), graded: Number(data.graded || 0), late: Number(data.lateSubmissions || 0) })
      setActivityOptions(activitiesResponse.results.map((activity) => ({ id: activity.id, title: activity.title || 'Untitled activity', type: activity.activity_type || activity.type || '' })))
    }).catch((error) => {
      if (error.response?.status === 401) navigate('/admin/login')
      else console.error('Failed to load submission filters or statistics', error)
    })
    return () => { active = false }
  }, [navigate])

  const filteredSubmissions = submissions
  const totalSubmissions = stats.total
  const lateCount = stats.late
  const pendingCount = stats.pending
  const gradedCount = stats.graded

  const handleSubmissionAction = (action, row) => {
    if (action === 'view') {
      setSelectedSubmissionId(row.id)
      setIsViewOpen(true)
    }
  }

  const columns = [
    {
      key: 'student',
      label: 'Student',
      className: 'w-[15%]',
      render: (_value, row) => {
        const studentName = row.student_name || `${row.student?.first_name || ''} ${row.student?.last_name || ''}`.trim() || '—'
        return (
          <div className="space-y-1">
            <div className="font-medium text-[#111827]">{studentName}</div>
            <div className="text-xs text-[#6B7280]">{row.student?.student_id || '—'}</div>
          </div>
        )
      },
    },
    {
      key: 'activity',
      label: 'Activity',
      className: 'w-[19%]',
      render: (_value, row) => (
        <div className="space-y-1">
          <div className="font-medium text-[#111827]">{row.activity_title || row.activity?.title || '—'}</div>
          <div className="text-xs text-[#6B7280]">{resolveActivityType(row)}</div>
        </div>
      ),
    },
    {
      key: 'section',
      label: 'Section',
      className: 'w-[11%]',
      render: (_value, row) => row.student?.section_name || row.student?.section?.section_name || '—',
    },
    {
      key: 'submitted_at',
      label: 'Submitted',
      className: 'w-[16%]',
      render: (value, row) => formatDate(value || row.submitted_at),
    },
    {
      key: 'status',
      label: 'Status',
      className: 'w-[11%]',
      render: (_value, row) => {
        const status = resolveStatus(row)
        const label = status === 'unknown' ? 'Unknown' : status.charAt(0).toUpperCase() + status.slice(1)
        return <StatusBadge status={status} label={label} />
      },
    },
    {
      key: 'score',
      label: 'Grade',
      className: 'w-[9%]',
      render: (_value, row) => (row.score != null ? `${row.score} / 100` : '—'),
    },
    {
      key: 'actions',
      label: 'Action',
      className: 'w-[9%] text-left',
      render: (_value, row) => <SubmissionActionsMenu submission={row} onAction={handleSubmissionAction} />,
    },
  ]

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        title="Submissions Management"
        description="Monitor and manage all student activity submissions."
      />

      <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
        <SummaryCard icon={Send} title={`Total ${pluralize(totalSubmissions, 'Submission', 'Submissions')}`} value={totalSubmissions} trendText="All student submissions" iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={CheckCircle2} title="Graded" value={gradedCount} trendText="Fully reviewed" trendColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-900" />
        <SummaryCard icon={Clock} title="Pending Review" value={pendingCount} trendText="Awaiting review" trendColor="text-amber-700" iconBg="bg-amber-50" iconColor="text-amber-900" />
        <SummaryCard icon={AlertCircle} title="Late" value={lateCount} trendText="Past due date" trendColor="text-rose-600" iconBg="bg-rose-50" iconColor="text-rose-900" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <section className="min-w-0 rounded-[12px] border border-[#E5E7EB] bg-white p-3 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#102a4c]">Submission Directory</h2>
            <p className="text-sm text-[#64748b]">Browse and review student submissions across activities.</p>
          </div>
        </div>

        <div className="mb-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SearchField value={query} onChange={(value) => { setQuery(value); setPage(1) }} onClear={() => { setQuery(''); setPage(1) }} placeholder="Search student, ID, activity, or section" ariaLabel="Search submissions" clearLabel="Clear submission search" />
          <label className="min-w-0"><span className="sr-only">Filter activity</span><select value={activityIdFilter} onChange={(event) => { setActivityIdFilter(event.target.value); setPage(1) }} className="tt-control w-full"><option value="">All activities</option>{activityOptions.map((activity) => <option key={activity.id} value={activity.id}>{activity.title}{activity.type ? ` · ${activity.type}` : ''}</option>)}</select></label>
          <label className="min-w-0"><span className="sr-only">Filter submission status</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="tt-control w-full">{statusOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}</select></label>
          <label className="min-w-0"><span className="sr-only">Submission date</span><input type="date" aria-label="Submission date" value={submittedDate} onChange={(event) => { setSubmittedDate(event.target.value); setPage(1) }} className="tt-control w-full" /></label>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <span>{pluralize(totalCount, 'result')}{loading ? ' · Loading…' : ''}</span>
          {(query || activityIdFilter || statusFilter || submittedDate) && <button type="button" onClick={() => { setQuery(''); setActivityIdFilter(''); setStatusFilter(''); setSubmittedDate(''); setPage(1) }} className="min-h-9 text-xs font-semibold text-[#1d5b91] hover:underline">Reset Filters</button>}
        </div>

        <DataTable
          columns={columns}
          data={filteredSubmissions}
          loading={loading}
          expandable
          variant="admin"
          constrainTableHeight={false}
          renderMobileCard={(row, { expanded, toggleExpanded }) => {
            const name = `${row.student_name || ''} ${row.student_last_name || ''}`.trim() || 'Unknown student'
            const status = resolveStatus(row)
            const grade = row.score != null ? `${row.score} / ${row.activity_max_score ?? row.activity?.max_score ?? '—'}` : 'Not graded'
            return (
              <div className="min-w-0">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-[#102a4c]">{name}</p>
                    <p className="break-all text-xs text-slate-500">{row.student_id || row.student?.student_id || 'Student ID unavailable'}</p>
                  </div>
                  <SubmissionActionsMenu submission={row} onAction={handleSubmissionAction} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={status} label={status === 'graded' ? 'Graded' : status === 'late' ? 'Late' : 'Submitted'} /></div>
                <p className="mt-2 break-words text-sm font-medium text-slate-800">{row.activity_title || row.activity?.title || 'Activity'}</p>
                <p className="text-xs text-slate-500">{resolveActivityType(row)}</p>
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-xs">
                  <dt className="text-slate-500">Submitted</dt><dd className="break-words text-right text-slate-700">{formatDate(row.submitted_at)}</dd>
                  <dt className="text-slate-500">Section</dt><dd className="break-words text-right text-slate-700">{row.student?.section_name || row.student_section || '—'}</dd>
                  <dt className="text-slate-500">Grade</dt><dd className="break-words text-right font-medium text-slate-700">{grade}</dd>
                </dl>
                <button type="button" aria-expanded={expanded} onClick={toggleExpanded} className="mt-2 min-h-9 text-xs font-semibold text-[#1d5b91] hover:underline">{expanded ? 'Hide details' : 'More details'}</button>
                {expanded && <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 text-xs"><p className="whitespace-pre-wrap break-words"><strong>Instructor:</strong> {resolveInstructor(row)}</p><p className="whitespace-pre-wrap break-words"><strong>Remarks:</strong> {row.remarks || '—'}</p><p className="whitespace-pre-wrap break-words"><strong>Feedback:</strong> {row.feedback || '—'}</p></div>}
              </div>
            )
          }}
          renderExpandedRow={(row) => (
            <ExpandedDetailsGrid
              items={[
                { label: 'Student ID', value: row.student?.student_id || row.student_id || 'Student ID unavailable' },
                { label: 'Instructor', value: resolveInstructor(row) },
                { label: 'Section', value: row.student?.section_name || row.student_section || 'No section assigned' },
                { label: 'Submission time', value: formatDate(row.submitted_at) },
                { label: 'Remarks', value: row.remarks || 'No remarks provided', className: 'sm:col-span-2' },
                { label: 'Feedback', value: row.feedback || 'No feedback provided', className: 'sm:col-span-2' },
              ]}
            />
          )}
          emptyMessage={query || activityIdFilter || statusFilter || submittedDate ? 'No submissions match your filters.' : 'No submissions available.'}
        />
        {!loading && pageCount > 1 && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} label="Page" />}
      </section>

      <ViewSubmissionModal
        isOpen={isViewOpen}
        submissionId={selectedSubmissionId}
        onClose={() => setIsViewOpen(false)}
        onUnauthorized={() => navigate('/admin/login')}
      />

    </div>
  )
}
