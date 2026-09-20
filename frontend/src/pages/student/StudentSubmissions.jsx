import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Clock, CheckCircle2, ArrowUpRight, FilePlus, RotateCcw } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import ViewSubmissionModal from '../../components/submissions/ViewSubmissionModal.jsx'

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'graded', label: 'Graded' },
  { value: 'returned_for_revision', label: 'Returned for Revision' },
  { value: 'late', label: 'Late' },
]

const sortOptions = [
  { value: '-submitted_at', label: 'Newest' },
  { value: 'submitted_at', label: 'Oldest' },
  { value: 'activity__title', label: 'Activity Title' },
]

function getDisplayStatus(submission) {
  const status = String(submission?.status || submission?.submission_status || '').toLowerCase()
  const score = submission?.score ?? submission?.grade
  const hasFeedback = Boolean(submission?.feedback && String(submission.feedback).trim())
  const hasLateFlag = status === 'late' || submission?.is_late || submission?.late
  const submittedAt = submission?.submitted_at
  const dueDate = submission?.activity_due_date || submission?.activity?.due_date

  let isLate = hasLateFlag
  if (!isLate && submittedAt && dueDate) {
    isLate = new Date(submittedAt) > new Date(dueDate)
  }

  if (score != null) return 'Graded'
  if (hasFeedback) return 'Returned for Revision'
  if (isLate) return 'Late'
  if (status === 'graded') return 'Graded'
  if (status === 'returned_for_revision') return 'Returned for Revision'
  if (status === 'late') return 'Late'
  if (status === 'under_review' || status === 'submitted' || status === 'pending') return 'Under Review'
  return 'Submitted'
}

function statusBadge(status) {
  const normalized = String(status || '').toLowerCase()
  const styles = {
    submitted: 'bg-sky-100 text-sky-700',
    under_review: 'bg-amber-100 text-amber-700',
    graded: 'bg-emerald-100 text-emerald-700',
    returned_for_revision: 'bg-rose-100 text-rose-700',
    late: 'bg-orange-100 text-orange-700',
  }
  return styles[normalized] || 'bg-slate-100 text-slate-700'
}

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

function buildStats(list) {
  return {
    submitted: list.length,
    underReview: list.filter((submission) => getDisplayStatus(submission) === 'Under Review').length,
    graded: list.filter((submission) => getDisplayStatus(submission) === 'Graded').length,
    returnedForRevision: list.filter((submission) => getDisplayStatus(submission) === 'Returned for Revision').length,
  }
}

export default function StudentSubmissions() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    submitted: 0,
    underReview: 0,
    graded: 0,
    returnedForRevision: 0,
  })
  const [submissions, setSubmissions] = useState([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('-submitted_at')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [activeSubmission, setActiveSubmission] = useState(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        search: query || undefined,
        ordering: sortBy,
        page,
      }
      if (statusFilter && statusFilter !== 'all') {
        params.status = statusFilter
      }
      const response = await api.get('/submissions/', { params })
      const nextSubmissions = response.data.results || []
      setSubmissions(nextSubmissions)
      setStats(buildStats(nextSubmissions))
      setPageCount(Math.ceil((response.data.count || 0) / (response.data.page_size || 10)))
    } catch (err) {
      console.error('Failed to load submissions:', err)
    } finally {
      setLoading(false)
    }
  }, [page, query, sortBy, statusFilter])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchSubmissions, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchSubmissions])

  useEffect(() => {
    const handler = () => { fetchSubmissions() }
    window.addEventListener('studentSubmissionSaved', handler)
    return () => window.removeEventListener('studentSubmissionSaved', handler)
  }, [fetchSubmissions])

  const handleViewSubmission = async (submission) => {
    // Open submission viewer modal
    setActiveSubmission(submission)
    setIsViewModalOpen(true)
  }

  const tableColumns = useMemo(() => [
    { key: 'activity_title', label: 'Activity Title' },
    { key: 'submitted_at', label: 'Submitted Date', render: (value) => formatDate(value) },
    {
      key: 'status',
      label: 'Submission Status',
      render: (_value, row) => {
        const displayStatus = getDisplayStatus(row)
        return (
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusBadge(displayStatus)}`}>
            {displayStatus}
          </span>
        )
      },
    },
    {
      key: 'grade',
      label: 'Grade',
      render: (_value, row) => {
        const score = row?.score
        const max = row?.activity_max_score ?? row?.activity?.max_score
        if (score == null) return '—'
        return max != null ? `${score} / ${max}` : String(score)
      },
    },
    {
      key: 'feedback',
      label: 'Instructor Feedback',
      render: (value) => {
        const feedback = value || 'No feedback yet.'
        return <span className="text-sm text-slate-600">{feedback.length > 70 ? `${feedback.slice(0, 70)}…` : feedback}</span>
      },
    },
    {
      key: 'actions',
      label: 'Action',
      render: (_, row) => (
        <button
          type="button"
          onClick={() => handleViewSubmission(row)}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowUpRight size={16} /> View Submission
        </button>
      ),
    },
  ], [])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Submission History"
        description="Review your submitted work, progress, and instructor results in one place."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<FilePlus size={18} />}
          label="Submitted"
          value={stats.submitted}
          subtitle="Activities submitted"
        />
        <StatCard
          icon={<Clock size={18} />}
          label="Under Review"
          value={stats.underReview}
          subtitle="Awaiting instructor review"
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label="Graded"
          value={stats.graded}
          subtitle="Completed with scores"
        />
        <StatCard
          icon={<RotateCcw size={18} />}
          label="Returned for Revision"
          value={stats.returnedForRevision}
          subtitle="Needs revision"
        />
      </div>

      <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex w-full items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm focus-within:border-transparent focus-within:ring-2 focus-within:ring-blue-900">
              <Search size={16} className="text-slate-500" />
              <input
                type="text"
                placeholder="Search activity or instructor"
                value={query}
                onChange={(event) => {
                  setPage(1)
                  setQuery(event.target.value)
                }}
                className="ml-3 min-w-[240px] bg-transparent text-sm text-slate-900 outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(1)
                setStatusFilter(event.target.value)
              }}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(event) => {
                setPage(1)
                setSortBy(event.target.value)
              }}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="text-sm text-slate-500">
            Showing {submissions.length} of {stats.submitted} submissions
          </div>
        </div>

        {loading ? (
          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-12 text-center text-[#6B7280] shadow-sm">Loading submissions...</div>
        ) : submissions.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-12 text-center">
            <div className="mb-4 text-4xl text-[#9CA3AF]">No submissions yet.</div>
            <p className="text-sm text-[#6B7280]">Your submission history will appear here once you submit an activity.</p>
          </div>
        ) : (
          <DataTable
            columns={tableColumns}
            data={submissions}
            loading={loading}
            mobileCards
            emptyMessage="No submissions yet"
            showActions={false}
            pagination={{
              current: page,
              total: pageCount,
              onPageChange: setPage,
            }}
          />
        )}
      </div>
      <ViewSubmissionModal
        isOpen={isViewModalOpen}
        submission={activeSubmission}
        onClose={() => setIsViewModalOpen(false)}
      />
      
    </div>
  )
}
