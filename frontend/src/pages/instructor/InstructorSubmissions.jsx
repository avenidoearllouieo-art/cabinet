import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import Pagination from '../../components/Pagination'
import StatusBadge from '../../components/StatusBadge'
import ViewSubmissionModal from '../../components/submissions/ViewSubmissionModal.jsx'
import GradeSubmissionModal from '../../components/submissions/GradeSubmissionModal.jsx'
import { fetchAllResults } from '../../services/paginatedResults.js'
import {
  Search,
  Eye,
  CheckCircle2,
  Send,
  Filter,
  Circle,
} from 'lucide-react'

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

const sortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'highest_score', label: 'Highest Score' },
  { value: 'lowest_score', label: 'Lowest Score' },
]

export default function InstructorSubmissions() {
  const location = useLocation()
  const initialSectionId = new URLSearchParams(location.search).get('section') || ''
  const sectionScoped = Boolean(initialSectionId)
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedSection, setSelectedSection] = useState(initialSectionId)
  const [selectedActivity, setSelectedActivity] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [selectedSort, setSelectedSort] = useState('newest')
  const [sections, setSections] = useState([])
  const [activities, setActivities] = useState([])
  const [totalSubmissions, setTotalSubmissions] = useState(0)
  const [totalActivities, setTotalActivities] = useState(0)
  const [pendingReviewCount, setPendingReviewCount] = useState(0)
  const [gradedCount, setGradedCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isGradeModalOpen, setIsGradeModalOpen] = useState(false)
  const [selectedSubmission, setSelectedSubmission] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const activeSectionId = initialSectionId || selectedSection

  const fetchFilters = useCallback(async () => {
    try {
      const [sectionPage, activityPage] = await Promise.all([
        fetchAllResults(api, '/sections/'),
        fetchAllResults(api, '/activities/', activeSectionId ? { section: activeSectionId } : {}),
      ])
      setSections(sectionPage.results)
      setActivities(activityPage.results)
      setTotalActivities(activityPage.count)
    } catch (err) {
      console.error('Error fetching filter lists:', err)
    }
  }, [activeSectionId])

  const fetchSubmissions = useCallback(async () => {
    try {
      setLoading(true)
      const params = {
        search: query || undefined,
        student__section: activeSectionId || undefined,
        activity: selectedActivity || undefined,
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        ordering: selectedSort === 'oldest' ? 'submitted_at' : selectedSort === 'highest_score' ? '-score' : selectedSort === 'lowest_score' ? 'score' : '-submitted_at',
        page,
      }

      const [response, statsResponse] = await Promise.all([
        api.get('/submissions/', { params }),
        api.get('/submissions/stats/', { params: { ...params, page: undefined, ordering: undefined } }),
      ])
      const rawSubmissions = Array.isArray(response.data)
        ? response.data
        : response.data.results || []
      setSubmissions(rawSubmissions)
      const summary = statsResponse.data || {}
      setTotalSubmissions(summary.totalSubmissions ?? response.data.count ?? rawSubmissions.length)
      setPendingReviewCount(summary.pendingReview ?? 0)
      setGradedCount(summary.graded ?? 0)
      setPageCount(Math.max(1, Math.ceil((response.data.count ?? rawSubmissions.length) / 10)))
      setError('')
    } catch (err) {
      console.error('Error fetching submissions:', err)
      setError('Failed to load submissions.')
    } finally {
      setLoading(false)
    }
  }, [activeSectionId, page, query, selectedActivity, selectedSort, selectedStatus])

  const handleSubmissionGraded = async (gradedSubmission) => {
    setSubmissions((existing) =>
      existing.map((sub) => (sub.id === gradedSubmission.id ? gradedSubmission : sub))
    )
    setIsGradeModalOpen(false)
    setSelectedSubmission(null)
    window.dispatchEvent(new CustomEvent('studentSubmissionSaved'))
    await fetchSubmissions()
    setToastMessage('Submission grade saved successfully.')
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

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchFilters, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchFilters])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchSubmissions, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchSubmissions])

  const filteredSubmissions = useMemo(() => {
    return submissions
  }, [submissions])

  const columns = [
    {
      key: 'student_id',
      label: 'Student',
      className: 'min-w-[150px]',
      render: (_value, row) => <div><p className="font-semibold text-[#102a4c]">{`${row.student_name || ''} ${row.student_last_name || ''}`.trim() || row.student_username || 'Unknown student'}</p><p className="text-xs text-slate-500">{row.student_id || 'ID unavailable'}</p></div>,
    },
    {
      key: 'student_section',
      label: 'Section',
      className: 'min-w-[95px]',
      render: (value) => value || '—',
    },
    {
      key: 'activity_title',
      label: 'Activity',
      className: 'min-w-[150px]',
      render: (value) => value || '—',
    },
    {
      key: 'submitted_at',
      label: 'Submitted At',
      className: 'min-w-[135px]',
      render: (value) => formatDate(value),
    },
    {
      key: 'status',
      label: 'Status',
      className: 'min-w-[100px]',
      render: (_value, row) => {
        const label = row.status ? String(row.status).replaceAll('_', ' ') : 'Unknown'
        return <StatusBadge status={label} label={label} />
      },
    },
    {
      key: 'score',
      label: 'Score',
      className: 'min-w-[70px]',
      render: (value) => (value !== null && value !== undefined ? value : 'Pending'),
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[145px]',
      render: (_value, row) => (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleViewSubmission(row)}
            className="instructor-table-action"
            title="View submission"
          >
            <Eye size={14} />
            View
          </button>
          <button
            onClick={() => handleGradeSubmission(row)}
            className="instructor-table-action"
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
    <div className="space-y-5">
      <div className="space-y-3">
        <PageHeader title="Instructor Submissions" description="Review, grade, and track student submissions." />

        <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
          <StatCard icon={<Circle />} label="Activities" value={totalActivities} subtitle="Created by you" />
          <StatCard icon={<Send />} label="Submissions" value={totalSubmissions} subtitle="Received" />
          <StatCard icon={<Filter />} label="Pending Review" value={pendingReviewCount} subtitle="Awaiting grading" bgColor="bg-amber-50" textColor="text-amber-900" />
          <StatCard icon={<CheckCircle2 />} label="Graded" value={gradedCount} subtitle="Reviewed" bgColor="bg-emerald-50" textColor="text-emerald-900" />
        </div>
      </div>

      <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
        <div className="mb-4 flex w-full flex-col items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white p-3 md:flex-row">
          <div className="flex h-11 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 shadow-sm focus-within:border-transparent focus-within:ring-2 focus-within:ring-blue-900 md:max-w-md">
            <Search size={18} className="text-slate-400" />
            <input
              type="text"
              placeholder="Search student ID, name, or activity..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1) }}
              className="h-11 flex-1 border-0 bg-transparent text-sm outline-none"
            />
          </div>

          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <label className="flex min-w-[150px] flex-col text-sm text-slate-700">
            Section
            <select
              value={activeSectionId}
              onChange={(e) => { setSelectedSection(e.target.value); setPage(1) }}
              className="mt-2 h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-sky-400"
            >
              {!sectionScoped && <option value="">All Sections</option>}
              {sections.filter((section) => !sectionScoped || String(section.id) === String(initialSectionId)).map((section) => (
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
              onChange={(e) => { setSelectedActivity(e.target.value); setPage(1) }}
              className="mt-2 h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-sky-400"
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
              onChange={(e) => { setSelectedStatus(e.target.value); setPage(1) }}
              className="mt-2 h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-sky-400"
            >
              <option value="all">All</option>
              <option value="submitted">Submitted</option>
              <option value="late">Late</option>
              <option value="graded">Graded</option>
            </select>
          </label>

          <label className="flex flex-col text-sm text-slate-700">
            Sort by
            <select
              value={selectedSort}
              onChange={(e) => { setSelectedSort(e.target.value); setPage(1) }}
              className="mt-2 h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-sky-400"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          </div>
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
            <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-8 text-center">
              <div className="mb-3 flex justify-center text-4xl text-[#2563EB]">
                <Send size={32} />
              </div>
              <p className="text-[#6B7280]">
                {query ? 'No submissions match your filters.' : 'No submissions available.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
            <DataTable
              columns={columns}
              rows={filteredSubmissions}
              variant="instructor"
              renderMobileCard={(row) => (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="break-words font-semibold text-[#102a4c]">{`${row.student_name || ''} ${row.student_last_name || ''}`.trim() || row.student_username || 'Unknown student'}</p><p className="text-xs text-slate-500">{row.student_id || 'ID unavailable'}</p></div>
                    <StatusBadge status={String(row.status || 'Unknown').replaceAll('_', ' ')} />
                  </div>
                  <p className="break-words text-sm text-slate-700">{row.activity_title || 'Unknown activity'}</p>
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{formatDate(row.submitted_at)}</span><span>Score: {row.score ?? 'Pending'}</span></div>
                  <div className="flex gap-2 border-t border-slate-100 pt-2">
                    <button type="button" onClick={() => handleViewSubmission(row)} className="instructor-table-action"><Eye size={14} />View</button>
                    <button type="button" onClick={() => handleGradeSubmission(row)} className="instructor-table-action"><CheckCircle2 size={14} />{row.score == null ? 'Grade' : 'Edit Grade'}</button>
                  </div>
                </div>
              )}
            />
            {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />}
            </div>
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
