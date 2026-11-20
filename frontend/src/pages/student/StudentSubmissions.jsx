import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, CheckCircle2, ArrowUpRight, FilePlus, RotateCcw } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SearchField from '../../components/SearchField.jsx'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/StatusBadge'
import ViewSubmissionModal from '../../components/submissions/ViewSubmissionModal.jsx'
import { pluralize } from '../../utils/labels.js'

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

function formatDate(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Manila',
    }).format(date)
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
  const [totalCount, setTotalCount] = useState(0)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [activeSubmission, setActiveSubmission] = useState(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)

  const fetchSubmissions = useCallback(async (signal) => {
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
      const [response, summaryResponse] = await Promise.all([
        api.get('/submissions/', { params, signal }),
        api.get('/submissions/stats/', { params: { search: query.trim() || undefined }, signal }),
      ])
      if (signal?.aborted) return
      const nextSubmissions = Array.isArray(response.data) ? response.data : response.data.results || []
      setSubmissions(nextSubmissions)
      const summary = summaryResponse.data || {}
      setStats({
        submitted: Number(summary.totalSubmissions ?? response.data.count ?? nextSubmissions.length),
        underReview: Number(summary.underReview ?? 0),
        graded: Number(summary.graded ?? 0),
        returnedForRevision: Number(summary.returnedForRevision ?? 0),
      })
      const count = Array.isArray(response.data) ? nextSubmissions.length : Number(response.data.count || 0)
      setTotalCount(count)
      setPageCount(Math.max(1, Math.ceil(count / (response.data.page_size || 10))))
    } catch (err) {
      if (!signal?.aborted) console.error('Failed to load submissions:', err)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [page, query, sortBy, statusFilter])

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => fetchSubmissions(controller.signal), 0)
    return () => { window.clearTimeout(timeoutId); controller.abort() }
  }, [fetchSubmissions, refreshVersion])

  useEffect(() => {
    const handler = () => setRefreshVersion((current) => current + 1)
    window.addEventListener('studentSubmissionSaved', handler)
    return () => window.removeEventListener('studentSubmissionSaved', handler)
  }, [])

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
          <StatusBadge status={displayStatus} label={displayStatus} />
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

      <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
        <StatCard
          icon={<FilePlus size={18} />}
          label={pluralize(stats.submitted, 'Submission', 'Submissions')}
          value={stats.submitted}
          subtitle="Activities submitted"
        />
        <StatCard
          icon={<Clock size={18} />}
          label={`${pluralize(stats.underReview, 'Submission', 'Submissions')} Under Review`}
          value={stats.underReview}
          subtitle="Awaiting instructor review"
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label={`Graded ${pluralize(stats.graded, 'Submission', 'Submissions')}`}
          value={stats.graded}
          subtitle="Completed with scores"
        />
        <StatCard
          icon={<RotateCcw size={18} />}
          label={`Returned ${pluralize(stats.returnedForRevision, 'Submission', 'Submissions')} for Revision`}
          value={stats.returnedForRevision}
          subtitle="Needs revision"
        />
      </div>

      <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-wrap gap-3">
            <SearchField value={query} onChange={(value) => { setPage(1); setQuery(value) }} onClear={() => { setPage(1); setQuery('') }} placeholder="Search activity or instructor" ariaLabel="Search submissions" className="w-full min-w-0 md:max-w-[360px]" />
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
            Showing {pluralize(submissions.length, 'submission')} of {pluralize(totalCount, 'submission')}
            {(query || statusFilter !== 'all' || sortBy !== '-submitted_at') && <button type="button" onClick={() => { setQuery(''); setStatusFilter('all'); setSortBy('-submitted_at'); setPage(1) }} className="ml-3 min-h-9 text-xs font-semibold text-[#1d5b91] hover:underline">Reset Filters</button>}
          </div>
        </div>

        {loading ? (
          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-12 text-center text-[#6B7280] shadow-sm">Loading submissions...</div>
        ) : submissions.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-6 text-center sm:p-12">
            <div className="mb-4 text-2xl font-semibold text-[#9CA3AF] sm:text-4xl">No submissions yet.</div>
            <p className="text-sm text-[#6B7280]">Your submission history will appear here once you submit an activity.</p>
          </div>
        ) : (
          <DataTable
            columns={tableColumns}
            data={submissions}
            loading={loading}
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
