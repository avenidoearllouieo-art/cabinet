import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import StatusBadge from '../../components/StatusBadge'
import DataTable from '../../components/DataTable'
import SectionOverviewModal from '../../components/sections/SectionOverviewModal.jsx'
import { fetchAllResults } from '../../services/paginatedResults.js'
import SearchField from '../../components/SearchField.jsx'
import { pluralize } from '../../utils/labels.js'
import { BookOpen, Users, ClipboardCheck, Clock3 } from 'lucide-react'

const getStatusBadge = (status) => {
  if (!status) return <span className="inline-flex rounded-full px-3 py-1 text-xs font-semibold text-slate-600">—</span>
  return <StatusBadge status={status} label={status} />
}

const formatRelativeTime = (value) => {
  if (!value) return 'No recent activity'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently updated'

  const diffInMinutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000))
  if (diffInMinutes < 60) return `${diffInMinutes} min ago`

  const diffInHours = Math.round(diffInMinutes / 60)
  if (diffInHours < 24) return `${diffInHours} hr ago`

  const diffInDays = Math.round(diffInHours / 24)
  if (diffInDays < 7) return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`

  const diffInWeeks = Math.round(diffInDays / 7)
  return `${diffInWeeks} wk ago`
}

const formatYearLevel = (value) => {
  const raw = String(value || '').trim()
  if (!/^\d+$/.test(raw)) return raw || '—'
  const year = Number(raw)
  const suffix = year % 100 >= 11 && year % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[year % 10] || 'th')
  return `${year}${suffix}`
}

const formatAcademicYear = (value) => {
  const raw = String(value || '').trim()
  const schoolYear = raw.match(/^(\d{4})-(\d{4})$/)
  return schoolYear ? `${schoolYear[1]}–${schoolYear[2]}` : raw || '—'
}
const normalizeAcademicYear = (value) => formatAcademicYear(value)
const academicYears = ['2026–2027', '2027–2028']

export default function InstructorSections() {
  const navigate = useNavigate()
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [yearLevelFilter, setYearLevelFilter] = useState('all')
  const [academicYearFilter, setAcademicYearFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name-asc')
  const [selectedSection, setSelectedSection] = useState(null)

  const fetchSections = useCallback(async () => {
    try {
      setLoading(true)
      const { results } = await fetchAllResults(api, '/sections/')
      setSections(results)
      setError('')
    } catch (err) {
      console.error('Error fetching instructor sections:', err)
      setError('Failed to load sections.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchSections, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchSections])

  const selectedSectionId = selectedSection?.section_id ?? selectedSection?.id

  const availableYears = useMemo(
    () => [...new Set(sections.map((section) => section.year_level).filter(Boolean))].sort(),
    [sections],
  )

  const filteredSections = useMemo(() => {
    let result = [...sections]

    if (query.trim()) {
      const keyword = query.trim().toLowerCase()
      result = result.filter((section) =>
        [section.subject_code, section.section_name, section.academic_year, section.instructor_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    if (yearLevelFilter !== 'all') {
      result = result.filter((section) => String(section.year_level || '').toLowerCase() === yearLevelFilter.toLowerCase())
    }

    if (academicYearFilter !== 'all') {
      result = result.filter((section) => normalizeAcademicYear(section.academic_year).toLowerCase() === academicYearFilter.toLowerCase())
    }

    if (statusFilter !== 'all') {
      result = result.filter((section) => String(section.status || '').toLowerCase() === statusFilter)
    }

    result = result.sort((left, right) => {
      switch (sortBy) {
        case 'name-desc':
          return String(right.section_name || '').localeCompare(String(left.section_name || ''))
        case 'students-desc':
          return (Number(right.student_count || 0) || 0) - (Number(left.student_count || 0) || 0)
        case 'students-asc':
          return (Number(left.student_count || 0) || 0) - (Number(right.student_count || 0) || 0)
        case 'activities-desc':
          return (Number(right.activity_count || 0) || 0) - (Number(left.activity_count || 0) || 0)
        case 'updated-desc':
          return new Date(right.last_activity_at || 0) - new Date(left.last_activity_at || 0)
        case 'name-asc':
        default:
          return String(left.section_name || '').localeCompare(String(right.section_name || ''))
      }
    })

    return result
  }, [sections, query, yearLevelFilter, academicYearFilter, statusFilter, sortBy])

  const totalSections = sections.length
  const totalStudents = sections.reduce((sum, section) => sum + (Number(section.student_count) || 0), 0)
  const activeActivities = sections.reduce((sum, section) => sum + (Number(section.activity_count) || 0), 0)
  const pendingReviews = sections.reduce((sum, section) => sum + (Number(section.pending_review_count) || 0), 0)

  const openDrawer = (section) => {
    setSelectedSection(section)
  }

  const closeDrawer = useCallback(() => {
    setSelectedSection(null)
  }, [])

  const handleViewStudents = () => {
    if (!selectedSection) return
    navigate(`/instructor/sections/${selectedSection.section_id ?? selectedSection.id}/students`)
  }

  const handleViewActivities = () => {
    if (!selectedSectionId) return
    navigate(`/instructor/activities?section=${selectedSectionId}`)
  }

  const handleViewStudent = (studentId) => {
    if (!studentId) return
    navigate(`/instructor/students/${studentId}`)
  }

  const handleViewActivity = (activityId) => {
    if (!activityId) return
    navigate(`/instructor/activities/${activityId}`)
  }

  const handleViewSubmissions = () => {
    if (!selectedSectionId) return
    navigate(`/instructor/submissions?section=${selectedSectionId}`)
  }

  const handleViewAccess = () => {
    if (!selectedSectionId) return
    navigate(`/instructor/access-logs?section=${selectedSectionId}`)
  }

  const columns = [
    {
      key: 'section_name',
      label: 'Section',
      className: 'min-w-[180px]',
      render: (_value, section) => (
        <div>
          <p className="font-semibold text-[#102a4c]">{section.section_name || 'Unnamed Section'}</p>
          <p className="text-xs text-slate-500">{section.subject_code || '—'}</p>
        </div>
      ),
    },
    { key: 'year_level', label: 'Year', className: 'min-w-[80px]', render: (value) => formatYearLevel(value) },
    { key: 'student_count', label: 'Students', className: 'min-w-[90px]', render: (value) => value || 0 },
    { key: 'activity_count', label: 'Activities', className: 'min-w-[90px]', render: (value) => value || 0 },
    {
      key: 'submitted_count',
      label: 'Submissions',
      className: 'min-w-[140px]',
      render: (_value, section) => (
        <div>
          <p className="font-semibold text-[#102a4c]">{section.submitted_count || 0}/{section.expected_submission_count || 0} Submitted</p>
          <p className="text-xs text-slate-500">{section.missing_count || 0} Missing</p>
        </div>
      ),
    },
    {
      key: 'latest_activity_title',
      label: 'Last Activity',
      className: 'min-w-[160px]',
      render: (_value, section) => (
        <div>
          <p>{section.latest_activity_title || 'No activity'}</p>
          <p className="text-xs text-slate-500">{formatRelativeTime(section.last_activity_at)}</p>
        </div>
      ),
    },
    { key: 'status', label: 'Status', className: 'min-w-[100px]', render: (value) => getStatusBadge(value) },
    {
      key: 'actions',
      label: 'Action',
      className: 'min-w-[80px]',
      render: (_value, section) => (
        <button type="button" onClick={(event) => { event.stopPropagation(); openDrawer(section) }} className="instructor-text-action whitespace-nowrap hover:underline" aria-label={`View ${section.section_name} section`}>
          View →
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Sections" description="Review your assigned classes, students, activities, and submissions." />

      <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
        <StatCard icon={<BookOpen />} label={pluralize(totalSections, 'Section', 'Sections')} value={totalSections} subtitle="Classes assigned to you" bgColor="bg-blue-50" textColor="text-blue-900" />
        <StatCard icon={<Users />} label={pluralize(totalStudents, 'Student', 'Students')} value={totalStudents} subtitle="Across your sections" bgColor="bg-emerald-50" textColor="text-emerald-900" />
        <StatCard icon={<ClipboardCheck />} label={pluralize(activeActivities, 'Activity', 'Activities')} value={activeActivities} subtitle="Assigned to your sections" bgColor="bg-sky-50" textColor="text-sky-900" />
        <StatCard icon={<Clock3 />} label="Pending Reviews" value={pendingReviews} subtitle="Awaiting grading" bgColor="bg-amber-50" textColor="text-amber-900" />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex w-full flex-col items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white p-3 md:flex-row">
          <SearchField value={query} onChange={setQuery} onClear={() => setQuery('')} placeholder="Search sections..." ariaLabel="Search sections" className="w-full md:max-w-md" />

          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Year Level</label>
            <select value={yearLevelFilter} onChange={(event) => setYearLevelFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Filter by year level">
              <option value="all">All Levels</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>{formatYearLevel(year)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Academic Year</label>
            <select value={academicYearFilter} onChange={(event) => setAcademicYearFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Filter by academic year">
              <option value="all">All Years</option>
              {academicYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Status</label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Filter by status">
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Sort By</label>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Sort sections">
              <option value="name-asc">Section Name (A–Z)</option>
              <option value="name-desc">Section Name (Z–A)</option>
              <option value="students-desc">Most Students</option>
              <option value="students-asc">Least Students</option>
              <option value="activities-desc">Most Activities</option>
              <option value="updated-desc">Recently Updated</option>
            </select>
          </div>
          </div>
        </div>

        {(query || yearLevelFilter !== 'all' || academicYearFilter !== 'all' || statusFilter !== 'all' || sortBy !== 'name-asc') && (
          <div className="mb-4 flex justify-end">
            <button type="button" onClick={() => { setQuery(''); setYearLevelFilter('all'); setAcademicYearFilter('all'); setStatusFilter('all'); setSortBy('name-asc') }} className="min-h-9 rounded-lg border border-[#dbe5f0] bg-white px-3 py-1.5 text-sm font-semibold text-[#082b53] hover:bg-[#eef4fa]">Reset filters</button>
          </div>
        )}

        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Assigned sections</h2>
            <p className="text-sm text-slate-500">{filteredSections.length} sections matched your current filters.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-sm text-slate-500">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
              <span>Loading your sections…</span>
            </div>
          </div>
        ) : (
          <DataTable columns={columns} rows={filteredSections} loading={loading} variant="instructor" showActions={false} onRowClick={openDrawer} emptyMessage="No sections match your filters." />
        )}
      </div>

      <SectionOverviewModal
        key={selectedSectionId || 'closed'}
        isOpen={Boolean(selectedSection)}
        section={selectedSection}
        role="instructor"
        onClose={closeDrawer}
        onViewStudent={handleViewStudent}
        onViewActivity={handleViewActivity}
        onViewStudents={handleViewStudents}
        onViewActivities={handleViewActivities}
        onViewSubmissions={handleViewSubmissions}
        onViewAccess={handleViewAccess}
      />
    </div>
  )
}
