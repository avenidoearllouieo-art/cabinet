import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Send, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
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

const normalizeText = (value) => (value || '').toString().toLowerCase()

export default function Submissions() {
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [activityFilter, setActivityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [deletingSubmission, setDeletingSubmission] = useState(null)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    fetchSubmissions()
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
      const matchesStatusFilter = statusFilter === 'all' || status === statusFilter

      return matchesSearch && matchesActivityFilter && matchesStatusFilter
    })
  }, [submissions, query, activityFilter, statusFilter])

  const totalSubmissions = submissions.length
  const submittedCount = submissions.filter((submission) => resolveStatus(submission) === 'submitted').length
  const lateCount = submissions.filter((submission) => resolveStatus(submission) === 'late').length
  const pendingCount = submissions.filter((submission) => resolveStatus(submission) === 'pending').length
  const gradedCount = submissions.filter((submission) => resolveStatus(submission) === 'graded').length

  const columns = [
    {
      key: 'actions',
      label: 'Actions',
      className: 'w-[180px] text-left',
      render: (_value, row) => (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setSelectedSubmissionId(row.id)
              setIsViewOpen(true)
            }}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            View
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setDeletingSubmission(row)
            }}
            className="rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      ),
    },
    {
      key: 'student',
      label: 'Student',
      render: (_value, row) => row.student_name || `${row.student?.first_name || ''} ${row.student?.last_name || ''}`.trim() || '—',
    },
    {
      key: 'student_id',
      label: 'Student ID',
      render: (_value, row) => row.student?.student_id || '—',
    },
    {
      key: 'activity',
      label: 'Activity',
      render: (_value, row) => row.activity_title || row.activity?.title || '—',
    },
    {
      key: 'activity_type',
      label: 'Activity Type',
      render: (_value, row) => resolveActivityType(row) || '—',
    },
    {
      key: 'section',
      label: 'Section',
      render: (_value, row) => row.student?.section_name || row.student?.section?.section_name || '—',
    },
    {
      key: 'submitted_at',
      label: 'Submitted At',
      render: (value, row) => formatDate(value || row.submitted_at),
    },
    {
      key: 'score',
      label: 'Score',
      render: (_value, row) => (row.score != null ? row.score : '—'),
    },
    {
      key: 'status',
      label: 'Status',
      render: (_value, row) => {
        const status = resolveStatus(row)
        return (
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[status] || statusStyles.unknown}`}>
            {status === 'unknown' ? 'Unknown' : status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        )
      },
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

      <div className="grid gap-6 md:grid-cols-4">
        <StatCard icon={<Send size={18} />} label="Total Submissions" value={totalSubmissions} subtitle="All student submissions" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Submitted" value={submittedCount} subtitle="Received on time" />
        <StatCard icon={<AlertCircle size={18} />} label="Late" value={lateCount} subtitle="Past due date" />
        <StatCard icon={<Clock size={18} />} label="Not Graded" value={pendingCount} subtitle="Awaiting review" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Submission List</h2>
            <p className="text-sm text-[#6B7280]">Browse and review student submissions.</p>
          </div>
          <div className="grid w-full gap-3 md:w-auto md:grid-cols-3">
            <label className="relative block w-full md:w-[340px]">
              <span className="sr-only">Search submissions</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search student, activity, or section"
                className="w-full rounded-full border border-[#E5E7EB] bg-[#F9FAFB] py-3 pl-11 pr-4 text-sm text-[#111827] shadow-sm outline-none transition focus:border-[#2563EB] focus:bg-white"
              />
            </label>
            <label className="block w-full md:w-[220px]">
              <span className="sr-only">Filter activity type</span>
              <select
                value={activityFilter}
                onChange={(event) => setActivityFilter(event.target.value)}
                className="w-full rounded-full border border-[#E5E7EB] bg-[#F9FAFB] py-3 px-4 text-sm text-[#111827] outline-none transition focus:border-[#2563EB] focus:bg-white"
              >
                {activityTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block w-full md:w-[220px]">
              <span className="sr-only">Filter status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-full rounded-full border border-[#E5E7EB] bg-[#F9FAFB] py-3 px-4 text-sm text-[#111827] outline-none transition focus:border-[#2563EB] focus:bg-white"
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

        <DataTable columns={columns} data={filteredSubmissions} loading={loading} />
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
