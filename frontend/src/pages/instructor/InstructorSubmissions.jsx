import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import ViewSubmissionModal from '../../components/submissions/ViewSubmissionModal.jsx'
import GradeSubmissionModal from '../../components/submissions/GradeSubmissionModal.jsx'
import {
  Search,
  Eye,
  CheckCircle2,
  Send,
  Filter,
  ArrowUpDown,
  Circle,
} from 'lucide-react'

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

const statusBadge = (status) => {
  const normalized = String(status || '').toLowerCase()
  switch (normalized) {
    case 'graded':
      return 'bg-emerald-100 text-emerald-700'
    case 'late':
      return 'bg-orange-100 text-orange-700'
    case 'submitted':
      return 'bg-sky-100 text-sky-700'
    case 'missing':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

const sortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'highest_score', label: 'Highest Score' },
  { value: 'lowest_score', label: 'Lowest Score' },
]

export default function InstructorSubmissions() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedSection, setSelectedSection] = useState('')
  const [selectedActivity, setSelectedActivity] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [selectedSort, setSelectedSort] = useState('newest')
  const [sections, setSections] = useState([])
  const [activities, setActivities] = useState([])
  const [totalSubmissions, setTotalSubmissions] = useState(0)
  const [totalActivities, setTotalActivities] = useState(0)
  const [pendingReviewCount, setPendingReviewCount] = useState(0)
  const [gradedCount, setGradedCount] = useState(0)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isGradeModalOpen, setIsGradeModalOpen] = useState(false)
  const [selectedSubmission, setSelectedSubmission] = useState(null)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    fetchFilters()
  }, [])

  useEffect(() => {
    fetchSubmissions()
  }, [query, selectedSection, selectedActivity, selectedStatus, selectedSort])

  const fetchFilters = async () => {
    try {
      const [sectionsRes, activitiesRes] = await Promise.all([
        api.get('/sections/'),
        api.get('/activities/'),
      ])

      const sectionResults = Array.isArray(sectionsRes.data)
        ? sectionsRes.data
        : sectionsRes.data.results || []
      const activityResults = Array.isArray(activitiesRes.data)
        ? activitiesRes.data
        : activitiesRes.data.results || []

      setSections(sectionResults)
      setActivities(activityResults)
      setTotalActivities(activityResults.length)
    } catch (err) {
      console.error('Error fetching filter lists:', err)
    }
  }

  const buildOrderingParam = () => {
    switch (selectedSort) {
      case 'oldest':
        return 'submitted_at'
      case 'highest_score':
        return '-score'
      case 'lowest_score':
        return 'score'
      case 'newest':
      default:
        return '-submitted_at'
    }
  }

  const fetchSubmissions = async () => {
    try {
      setLoading(true)
      const params = {
        search: query || undefined,
        student__section: selectedSection || undefined,
        activity: selectedActivity || undefined,
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        ordering: buildOrderingParam(),
      }

      const response = await api.get('/submissions/', { params })
      const rawSubmissions = Array.isArray(response.data)
        ? response.data
        : response.data.results || []
      setSubmissions(rawSubmissions)
      setTotalSubmissions(response.data.count ?? rawSubmissions.length)
      setPendingReviewCount(rawSubmissions.filter((submission) => submission.score === null).length)
      setGradedCount(rawSubmissions.filter((submission) => submission.score !== null).length)
      setError('')
    } catch (err) {
      console.error('Error fetching submissions:', err)
      setError('Failed to load submissions.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmissionGraded = async (gradedSubmission) => {
    setSubmissions((existing) =>
      existing.map((sub) => (sub.id === gradedSubmission.id ? gradedSubmission : sub))
    )
    setPendingReviewCount((prev) => Math.max(0, prev - 1))
    setGradedCount((prev) => prev + 1)
    setToastMessage('Submission graded successfully.')
    setIsGradeModalOpen(false)
    setSelectedSubmission(null)
    window.dispatchEvent(new CustomEvent('studentSubmissionSaved'))
    await fetchSubmissions()
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  const handleViewSubmission = (submission) => {
    setSelectedSubmission(submission)
    setIsViewModalOpen(true)
  }

  const handleGradeSubmission = (submission) => {
    setSelectedSubmission(submission)
    setIsGradeModalOpen(true)
  }

  const filteredSubmissions = useMemo(() => {
    return submissions
  }, [submissions])

  const columns = [
    {
      key: 'student_id',
      label: 'Student ID',
      className: 'min-w-[120px]',
    },
    {
      key: 'student_name',
      label: 'Student Name',
      className: 'min-w-[180px]',
      render: (value, row) => `${value} ${row.student_last_name || ''}`.trim() || '—',
    },
    {
      key: 'student_section',
      label: 'Section',
      className: 'min-w-[160px]',
      render: (value) => value || '—',
    },
    {
      key: 'activity_title',
      label: 'Activity',
      className: 'min-w-[220px]',
      render: (value) => value || '—',
    },
    {
      key: 'submitted_at',
      label: 'Submitted At',
      className: 'min-w-[180px]',
      render: (value) => formatDate(value),
    },
    {
      key: 'status',
      label: 'Status',
      className: 'min-w-[120px]',
      render: (_value, row) => (
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>
          {row.status ? String(row.status).replace('-', ' ') : 'Unknown'}
        </span>
      ),
    },
    {
      key: 'score',
      label: 'Score',
      className: 'min-w-[100px]',
      render: (value) => (value !== null && value !== undefined ? value : 'Pending'),
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[220px]',
      render: (_value, row) => (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleViewSubmission(row)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-sky-50 hover:text-sky-600"
            title="View submission"
          >
            <Eye size={14} />
            View
          </button>
          <button
            onClick={() => handleGradeSubmission(row)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-600"
            title={row.score === null ? 'Grade submission' : 'Edit grade'}
          >
            <CheckCircle2 size={14} />
            {row.score === null ? 'Grade' : 'Edit'}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageHeader title="Instructor Submissions" description="Review, grade, and track student submissions." />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={<Circle size={18} />} label="Total Activities" value={totalActivities} subtitle="Your created activities" />
          <StatCard icon={<Send size={18} />} label="Total Submissions" value={totalSubmissions} subtitle="Submitted by students" />
          <StatCard icon={<Filter size={18} />} label="Pending Review" value={pendingReviewCount} subtitle="Awaiting your grading" />
          <StatCard icon={<CheckCircle2 size={18} />} label="Graded Submissions" value={gradedCount} subtitle="Already reviewed" />
        </div>
      </div>

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] xl:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <Search size={18} className="text-slate-400" />
            <input
              type="text"
              placeholder="Search student ID, name, or activity..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 border-0 bg-transparent text-sm outline-none"
            />
          </div>

          <label className="flex flex-col text-sm text-slate-700">
            Section
            <select
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
              className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
            >
              <option value="">All Sections</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.section_name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm text-slate-700">
            Activity
            <select
              value={selectedActivity}
              onChange={(e) => setSelectedActivity(e.target.value)}
              className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
            >
              <option value="">All Activities</option>
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.title}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm text-slate-700">
            Status
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
            >
              <option value="all">All</option>
              <option value="submitted">Submitted</option>
              <option value="late">Late</option>
              <option value="graded">Graded</option>
              <option value="missing">Missing</option>
            </select>
          </label>

          <label className="flex flex-col text-sm text-slate-700">
            Sort by
            <select
              value={selectedSort}
              onChange={(e) => setSelectedSort(e.target.value)}
              className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6">
          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading submissions...</div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-16 text-center">
              <div className="mb-3 flex justify-center text-4xl text-[#2563EB]">
                <Send size={32} />
              </div>
              <p className="text-[#6B7280]">
                {query ? 'No submissions match your filters.' : 'No submissions available.'}
              </p>
            </div>
          ) : (
            <DataTable columns={columns} rows={filteredSubmissions} />
          )}
        </div>
      </div>

      {toastMessage && (
        <div className="fixed bottom-6 right-6 rounded-lg bg-green-100 px-4 py-3 text-sm font-medium text-green-800 shadow-lg">
          {toastMessage}
        </div>
      )}

      <ViewSubmissionModal
        isOpen={isViewModalOpen}
        submission={selectedSubmission}
        onClose={() => {
          setIsViewModalOpen(false)
          setSelectedSubmission(null)
        }}
      />

      <GradeSubmissionModal
        isOpen={isGradeModalOpen}
        submission={selectedSubmission}
        onClose={() => {
          setIsGradeModalOpen(false)
          setSelectedSubmission(null)
        }}
        onSaved={handleSubmissionGraded}
      />
    </div>
  )
}
