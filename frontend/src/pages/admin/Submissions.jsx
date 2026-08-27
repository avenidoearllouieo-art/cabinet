import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search, Send, CheckCircle2, AlertCircle, Clock, MoreHorizontal, Eye, Trash2 } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import DataTable from '../../components/DataTable'
import ViewSubmissionModal from '../../components/submissions/ViewSubmissionModal.jsx'
import DeleteSubmissionModal from '../../components/submissions/DeleteSubmissionModal.jsx'

const activityTypeOptions = [
  { value: 'all', label: 'All Activities' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'project', label: 'Project' },
]

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'late', label: 'Late' },
  { value: 'graded', label: 'Graded' },
  { value: 'pending', label: 'Pending' },
]

const statusStyles = {
  submitted: 'bg-[#ECFDF5] text-[#16A34A]',
  late: 'bg-[#FEE2E2] text-[#B91C1C]',
  pending: 'bg-[#FEF3C7] text-[#92400E]',
  graded: 'bg-[#DBEAFE] text-[#1D4ED8]',
  unknown: 'bg-[#F3F4F6] text-[#475569]',
}

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch (err) {
    return String(value)
  }
}

const resolveActivityType = (submission) => {
  return (
    submission.activity_type ||
    submission.activity?.activity_type ||
    submission.activity?.type ||
    submission.activity?.description ||
    '—'
  )
}

const resolveStatus = (submission) => {
  const raw = submission.status ? String(submission.status).toLowerCase() : null
  if (raw === 'graded') return 'graded'
  if (raw === 'late') return 'late'
  if (raw === 'submitted') return 'submitted'
  if (raw === 'pending') return 'pending'

  const dueDate = submission.activity?.due_date
  const submittedAt = submission.submitted_at
  if (submittedAt && dueDate) {
    try {
      if (new Date(submittedAt) > new Date(dueDate)) return 'late'
    } catch (err) {
      // ignore invalid dates
    }
  }

  if (submission.score != null) return 'graded'
  if (submission.file || submittedAt) return 'submitted'
  return 'pending'
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

const normalizeText = (value) => (value || '').toString().toLowerCase()

export default function Submissions() {
  const navigate = useNavigate()
  const location = useLocation()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [activityFilter, setActivityFilter] = useState('all')
  const [activityIdFilter, setActivityIdFilter] = useState(() => {
    const params = new URLSearchParams(location.search)
    return params.get('activity') || ''
  })
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [deletingSubmission, setDeletingSubmission] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const [openActionId, setOpenActionId] = useState(null)
  const actionMenuRef = useRef(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setActivityIdFilter(params.get('activity') || '')
  }, [location.search])

  useEffect(() => {
    fetchSubmissions()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
        setOpenActionId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchSubmissions = async () => {
    try {
      setLoading(true)
      const response = await api.get('/submissions/')
      const rawData = Array.isArray(response.data) ? response.data : response.data.results || []
      setSubmissions(rawData)
      setError('')
    } catch (err) {
      console.error('Error fetching submissions:', err)
      setError('Failed to load submissions.')
    } finally {
      setLoading(false)
    }
  }

  const filteredSubmissions = useMemo(() => {
    const keyword = query.trim().toLowerCase()

    return submissions.filter((submission) => {
      const activityType = resolveActivityType(submission).toLowerCase()
      const status = resolveStatus(submission)
      const studentName = normalizeText(submission.student_name || `${submission.student?.first_name || ''} ${submission.student?.last_name || ''}`)
      const studentId = normalizeText(submission.student?.student_id)
      const activityTitle = normalizeText(submission.activity_title || submission.activity?.title)
      const sectionName = normalizeText(submission.student?.section_name || submission.student?.section?.section_name)

      const matchesSearch =
        !keyword ||
        [studentName, studentId, activityTitle, sectionName]
          .filter(Boolean)
          .some((value) => value.includes(keyword))

      const matchesActivityFilter = activityFilter === 'all' || activityType === activityFilter
      const matchesActivityIdFilter = !activityIdFilter || String(submission.activity?.id ?? submission.activity_id ?? submission.activity?.activity_id ?? '').toString() === String(activityIdFilter)
      const matchesStatusFilter = statusFilter === 'all' || status === statusFilter

      return matchesSearch && matchesActivityFilter && matchesActivityIdFilter && matchesStatusFilter
    })
  }, [submissions, query, activityFilter, activityIdFilter, statusFilter])

  const totalSubmissions = submissions.length
  const submittedCount = submissions.filter((submission) => resolveStatus(submission) === 'submitted').length
  const lateCount = submissions.filter((submission) => resolveStatus(submission) === 'late').length
  const pendingCount = submissions.filter((submission) => resolveStatus(submission) === 'pending').length
  const gradedCount = submissions.filter((submission) => resolveStatus(submission) === 'graded').length

  const columns = [
    {
      key: 'student',
      label: 'Student',
      className: 'min-w-[180px] whitespace-normal',
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
      className: 'min-w-[220px] whitespace-normal',
      render: (_value, row) => (
        <div className="space-y-1">
          <div className="font-medium text-[#111827]">{row.activity_title || row.activity?.title || '—'}</div>
          <div className="text-xs text-[#6B7280]">{resolveActivityType(row)}</div>
        </div>
      ),
    },
    {
      key: 'instructor',
      label: 'Instructor',
      className: 'min-w-[160px] whitespace-normal',
      render: (_value, row) => resolveInstructor(row),
    },
    {
      key: 'section',
      label: 'Section',
      className: 'min-w-[140px] whitespace-normal',
      render: (_value, row) => row.student?.section_name || row.student?.section?.section_name || '—',
    },
    {
      key: 'submitted_at',
      label: 'Submitted',
      className: 'min-w-[180px] whitespace-normal',
      render: (value, row) => formatDate(value || row.submitted_at),
    },
    {
      key: 'status',
      label: 'Status',
      className: 'min-w-[120px] whitespace-normal',
      render: (_value, row) => {
        const status = resolveStatus(row)
        return (
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[status] || statusStyles.unknown}`}>
            {status === 'unknown' ? 'Unknown' : status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        )
      },
    },
    {
      key: 'score',
      label: 'Score',
      className: 'min-w-[110px] whitespace-normal',
      render: (_value, row) => (row.score != null ? `${row.score} / 100` : '—'),
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'w-[90px] text-left',
      render: (_value, row) => (
        <div className="relative" ref={openActionId === row.id ? actionMenuRef : null}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpenActionId((current) => (current === row.id ? null : row.id))
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#D1D5DB] bg-white text-[#374151] transition hover:bg-[#F9FAFB]"
            aria-label="Open submission actions"
          >
            <MoreHorizontal size={16} />
          </button>

          {openActionId === row.id && (
            <div className="absolute right-0 z-30 mt-2 w-40 rounded-[10px] border border-[#E5E7EB] bg-white p-2 shadow-lg">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedSubmissionId(row.id)
                  setIsViewOpen(true)
                  setOpenActionId(null)
                }}
                className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6]"
              >
                <Eye size={14} />
                View
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setDeletingSubmission(row)
                  setOpenActionId(null)
                }}
                className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#DC2626] transition hover:bg-[#FEF2F2]"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          )}
        </div>
      ),
    },
  ]

  const handleDeleteSuccess = () => {
    setDeletingSubmission(null)
    fetchSubmissions()
    setToastMessage('Submission deleted successfully.')
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Submissions Management"
        description="Monitor and manage all student activity submissions."
      />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Send} title="Total Submissions" value={totalSubmissions} trendText="All student submissions" iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={CheckCircle2} title="Graded" value={gradedCount} trendText="Fully reviewed" trendColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-900" />
        <SummaryCard icon={Clock} title="Pending Review" value={pendingCount} trendText="Awaiting review" trendColor="text-amber-700" iconBg="bg-amber-50" iconColor="text-amber-900" />
        <SummaryCard icon={AlertCircle} title="Late" value={lateCount} trendText="Past due date" trendColor="text-rose-600" iconBg="bg-rose-50" iconColor="text-rose-900" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Submission Directory</h2>
            <p className="text-sm text-[#6B7280]">Browse and review student submissions across activities.</p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-[360px]">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6B7280]">
              <Search size={16} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search submissions..."
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-10 text-sm text-slate-700 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
            />
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="block min-w-[180px]">
              <span className="sr-only">Filter activity type</span>
              <select
                value={activityFilter}
                onChange={(event) => setActivityFilter(event.target.value)}
                className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15"
              >
                {activityTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-[180px]">
              <span className="sr-only">Filter status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15"
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
          <div />
          <div>{filteredSubmissions.length} result{filteredSubmissions.length === 1 ? '' : 's'}</div>
        </div>

        <DataTable columns={columns} data={filteredSubmissions} loading={loading} emptyMessage={submissions.length ? 'No submissions match your filters.' : 'No submissions available.'} />
      </div>

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-[14px] border border-[#D1FAE5] bg-[#ECFDF5] px-5 py-4 text-sm text-[#065F46] shadow-lg">
          {toastMessage}
        </div>
      )}

      <ViewSubmissionModal
        isOpen={isViewOpen}
        submissionId={selectedSubmissionId}
        onClose={() => setIsViewOpen(false)}
        onUnauthorized={() => navigate('/admin/login')}
      />

      <DeleteSubmissionModal
        isOpen={Boolean(deletingSubmission)}
        submission={deletingSubmission}
        onClose={() => setDeletingSubmission(null)}
        onUnauthorized={() => navigate('/admin/login')}
        onDeleted={handleDeleteSuccess}
      />
    </div>
  )
}
