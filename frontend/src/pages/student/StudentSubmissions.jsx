import { useState, useEffect, useMemo } from 'react'
import { Search, Send, Clock, CheckCircle2, AlertCircle, Plus, ArrowUpRight, FilePlus } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import ViewSubmissionModal from '../../components/student/ViewSubmissionModal.jsx'
import SubmitActivityModal from '../../components/student/SubmitActivityModal.jsx'

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'late', label: 'Late' },
  { value: 'graded', label: 'Graded' },
]

const sortOptions = [
  { value: '-submitted_at', label: 'Newest' },
  { value: 'submitted_at', label: 'Oldest' },
  { value: 'activity__due_date', label: 'Due Date' },
  { value: 'activity__title', label: 'Activity Title' },
]

function statusBadge(status) {
  const styles = {
    draft: 'bg-gray-100 text-gray-700',
    submitted: 'bg-blue-100 text-blue-700',
    late: 'bg-orange-100 text-orange-700',
    graded: 'bg-green-100 text-green-700',
  }
  return styles[status?.toLowerCase()] || 'bg-gray-100 text-gray-700'
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

export default function StudentSubmissions() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalSubmissions: 0,
    pendingReview: 0,
    graded: 0,
    lateSubmissions: 0,
  })
  const [submissions, setSubmissions] = useState([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('-submitted_at')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [activeSubmission, setActiveSubmission] = useState(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState(null)

  useEffect(() => {
    fetchStats()
    fetchSubmissions()
  }, [query, statusFilter, sortBy, page])

  const fetchStats = async () => {
    try {
      const response = await api.get('/submissions/stats/')
      setStats(response.data)
    } catch (err) {
      console.error('Failed to load submission stats:', err)
    }
  }

  const fetchSubmissions = async () => {
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
      setSubmissions(response.data.results || [])
      setPageCount(Math.ceil((response.data.count || 0) / (response.data.page_size || 10)))
    } catch (err) {
      console.error('Failed to load submissions:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleViewSubmission = (submission) => {
    setActiveSubmission(submission)
    setIsViewModalOpen(true)
  }

  const handleOpenSubmitModal = (activity) => {
    setSelectedActivity(activity)
    setIsSubmitModalOpen(true)
  }

  const handleSubmissionSuccess = () => {
    setIsSubmitModalOpen(false)
    setSelectedActivity(null)
    fetchStats()
    fetchSubmissions()
  }

  const tableColumns = useMemo(() => [
    { key: 'activity_title', label: 'Activity Title' },
    { key: 'instructor_name', label: 'Instructor' },
    { key: 'submitted_at', label: 'Submitted At', render: (value) => formatDate(value) },
    { key: 'due_date', label: 'Due Date', render: (value) => formatDate(value) },
    {
      key: 'submission_status',
      label: 'Status',
      render: (value) => (
        <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusBadge(value)}`}>
          {value || 'Unknown'}
        </span>
      ),
    },
    { key: 'score', label: 'Score', render: (value) => (value != null ? `${value}/${100}` : '—') },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, row) => (
        <button
          type="button"
          onClick={() => handleViewSubmission(row)}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowUpRight size={16} /> View
        </button>
      ),
    },
  ], [])

  return (
    <div className="space-y-8">
      <PageHeader
        title="My Submissions"
        description="Track your activity submissions, grades, and feedback from instructors."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<FilePlus size={18} />}
          label="Total Submissions"
          value={stats.totalSubmissions}
          subtitle="All submissions submitted"
        />
        <StatCard
          icon={<Clock size={18} />}
          label="Pending Review"
          value={stats.pendingReview}
          subtitle="Awaiting instructor feedback"
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label="Graded"
          value={stats.graded}
          subtitle="Submissions with scores"
        />
        <StatCard
          icon={<AlertCircle size={18} />}
          label="Late Submissions"
          value={stats.lateSubmissions}
          subtitle="Submitted after deadline"
        />
      </div>

      <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 shadow-sm">
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
            Showing {submissions.length} of {stats.totalSubmissions} submissions
          </div>
        </div>

        <DataTable
          columns={tableColumns}
          data={submissions}
          loading={loading}
          showActions={false}
          pagination={{
            current: page,
            total: pageCount,
            onPageChange: setPage,
          }}
        />
      </div>

      <ViewSubmissionModal
        submission={activeSubmission}
        isOpen={isViewModalOpen}
        onClose={() => {
          setIsViewModalOpen(false)
          setActiveSubmission(null)
        }}
        onResubmit={(activity) => {
          setIsViewModalOpen(false)
          handleOpenSubmitModal(activity)
        }}
      />

      <SubmitActivityModal
        activity={selectedActivity}
        isOpen={isSubmitModalOpen}
        onClose={() => {
          setIsSubmitModalOpen(false)
          setSelectedActivity(null)
        }}
        onSuccess={handleSubmissionSuccess}
      />
    </div>
  )
}
