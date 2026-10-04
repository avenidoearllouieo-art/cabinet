import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import StatusBadge from '../../components/StatusBadge'
import DataTable from '../../components/DataTable'
import { Search, BookOpen, Users, ClipboardCheck, Clock3, BadgeCheck, CircleOff, X } from 'lucide-react'

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

const SectionDetailDrawer = ({ section, overview, overviewLoading, overviewError, onClose, onViewStudents, onViewActivities, onViewSubmissions, onViewAccess }) => {
  const metrics = overview?.counts || {}
  const students = overview?.students || []
  const sectionActivities = overview?.activities || []
  const accessLogs = overview?.access_logs || []
  const cabinetStations = overview?.cabinet_stations || []
  const studentCount = metrics.students || 0
  const activityCount = metrics.activities || 0
  const submittedCount = metrics.submitted || 0
  const expectedCount = metrics.expected || 0
  const missingCount = metrics.missing || 0
  const lateCount = metrics.late || 0
  const completionRate = expectedCount ? Math.round((submittedCount / expectedCount) * 100) : 0
  const sectionData = overview?.section || section

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex bg-[#071f41]/55 backdrop-blur-[2px]">
      <button type="button" className="flex-1" onClick={onClose} aria-label="Close section drawer" />
      <aside className="relative flex w-full max-w-[600px] flex-col overflow-y-auto border-l border-[#dbe5f0] bg-[#f7f9fc] shadow-[-18px_0_50px_rgba(0,43,91,0.18)] sm:p-0">
        <button
          type="button"
          onClick={onClose}
          className="sticky right-4 top-4 z-20 ml-auto mr-4 mt-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#cbd8e6] bg-white text-[#28415f] shadow-sm transition hover:border-[#002B5B] hover:bg-[#f4f8fc]"
          aria-label="Close section drawer"
          title="Close details"
        >
          <X size={18} />
        </button>

        <div className="space-y-4 px-4 pb-6 pt-2 sm:px-6">
          {overviewLoading && <p className="text-sm text-slate-500">Loading this section&apos;s workspace…</p>}
          {overviewError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{overviewError}</p>}
          <div className="rounded-xl border border-[#dbe5f0] bg-white p-5 shadow-[0_8px_24px_rgba(25,55,89,0.06)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#eef4fa] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#1d5b91]">
                Section overview
              </span>
              {getStatusBadge(sectionData.status)}
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#102a4c]">{sectionData.section_name || 'Unnamed Section'}</h2>
            <p className="mt-1 text-sm font-medium text-[#64748b]">{sectionData.subject_code || 'Subject Code not available'}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
              <p className="text-sm font-bold text-[#28415f]">Section information</p>
              <div className="mt-3 space-y-2.5 text-sm text-[#64748b]">
                <div className="flex items-center justify-between gap-2"><span>Program</span><span className="text-right font-semibold text-[#28415f]">{sectionData.program || 'Not assigned'}</span></div>
                <div className="flex items-center justify-between gap-2"><span>Year level</span><span className="text-right font-semibold text-[#28415f]">{sectionData.year_level || 'Not assigned'}</span></div>
                <div className="flex items-center justify-between gap-2"><span>Academic year</span><span className="text-right font-semibold text-[#28415f]">{sectionData.academic_year || 'Not assigned'}</span></div>
                <div className="flex items-center justify-between gap-2"><span>Instructor</span><span className="text-right font-semibold text-[#28415f]">{sectionData.instructor_name || 'Not assigned'}</span></div>
              </div>
            </div>
            <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
              <p className="text-sm font-bold text-[#28415f]">Section analytics</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#e7edf4] bg-[#f7f9fc] p-3">
                  <div className="flex items-center gap-2 text-[#64748b]"><Users size={15} /> <span className="text-xs">Students</span></div>
                  <p className="mt-1 text-2xl font-bold text-[#102a4c]">{studentCount}</p>
                </div>
                <div className="rounded-xl border border-[#e7edf4] bg-[#f7f9fc] p-3">
                  <div className="flex items-center gap-2 text-[#64748b]"><BookOpen size={15} /> <span className="text-xs">Activities</span></div>
                  <p className="mt-1 text-2xl font-bold text-[#102a4c]">{sectionActivities.length}</p>
                </div>
                <div className="rounded-xl border border-[#e7edf4] bg-[#f7f9fc] p-3">
                  <div className="flex items-center gap-2 text-[#64748b]"><BadgeCheck size={15} /> <span className="text-xs">Submitted</span></div>
                  <p className="mt-1 text-2xl font-bold text-[#102a4c]">{submittedCount}/{expectedCount}</p>
                </div>
                <div className="rounded-xl border border-[#e7edf4] bg-[#f7f9fc] p-3">
                  <div className="flex items-center gap-2 text-[#64748b]"><Clock3 size={15} /> <span className="text-xs">Missing</span></div>
                  <p className="mt-1 text-2xl font-bold text-[#102a4c]">{missingCount}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={onViewStudents} className="rounded-xl border border-[#dbe5f0] bg-white p-4 text-left shadow-sm transition hover:border-[#FFC107] hover:shadow-md">
              <span className="flex items-center gap-2 text-sm font-bold text-[#102a4c]"><Users size={17} /> STUDENTS</span>
              <span className="mt-2 block text-sm text-slate-600">{studentCount} students</span>
              <span className="mt-3 block text-sm font-semibold text-[#1d5b91]">View →</span>
            </button>
            <button type="button" onClick={onViewActivities} className="rounded-xl border border-[#dbe5f0] bg-white p-4 text-left shadow-sm transition hover:border-[#FFC107] hover:shadow-md">
              <span className="flex items-center gap-2 text-sm font-bold text-[#102a4c]"><BookOpen size={17} /> ACTIVITIES</span>
              <span className="mt-2 block text-sm text-slate-600">{activityCount} activities</span>
              <span className="mt-3 block text-sm font-semibold text-[#1d5b91]">View →</span>
            </button>
            <button type="button" onClick={onViewSubmissions} className="rounded-xl border border-[#dbe5f0] bg-white p-4 text-left shadow-sm transition hover:border-[#FFC107] hover:shadow-md">
              <span className="flex items-center gap-2 text-sm font-bold text-[#102a4c]"><ClipboardCheck size={17} /> SUBMISSIONS</span>
              <span className="mt-2 block text-sm text-slate-600">{submittedCount} submitted · {missingCount} missing</span>
              <span className="mt-3 block text-sm font-semibold text-[#1d5b91]">View →</span>
            </button>
            <button type="button" onClick={onViewAccess} className="rounded-xl border border-[#dbe5f0] bg-white p-4 text-left shadow-sm transition hover:border-[#FFC107] hover:shadow-md">
              <span className="flex items-center gap-2 text-sm font-bold text-[#102a4c]"><CircleOff size={17} /> CABINET ACCESS</span>
              <span className="mt-2 block text-sm text-slate-600">{cabinetStations.length ? cabinetStations.map((item) => item.station).join(', ') : 'No cabinet assigned'}</span>
              <span className="mt-3 block text-sm font-semibold text-[#1d5b91]">View →</span>
            </button>
          </div>

          <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#28415f]">Student preview</p>
                <p className="text-xs text-slate-500">A quick look at enrolled learners</p>
              </div>
              <button type="button" onClick={onViewStudents} className="shrink-0 text-xs font-semibold text-[#1d5b91] hover:underline" title="View all students">View all →</button>
            </div>
            <div className="mt-4 space-y-2">
              {students.slice(0, 4).map((student) => (
                <div key={student.id || student.student_id} className="flex items-center justify-between rounded-xl border border-[#e7edf4] bg-[#f7f9fc] px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dcecf9] text-sm font-bold text-[#1d5b91]">
                      {(student.first_name?.[0] || student.last_name?.[0] || 'S').toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{`${student.first_name || ''} ${student.last_name || ''}`.trim() || 'Unnamed Student'}</p>
                      <p className="text-xs text-slate-500">{student.student_id || 'Student ID not set'}</p>
                    </div>
                  </div>
                </div>
              ))}
              {studentCount > 4 && <p className="text-sm text-slate-500">+{studentCount - 4} more learners</p>}
              {!studentCount && <p className="text-sm text-slate-500">No students are currently linked to this section.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#28415f]">Latest activities</p>
                <p className="text-xs text-slate-500">Most recent class work for this section</p>
              </div>
              <button type="button" onClick={onViewActivities} className="shrink-0 text-xs font-semibold text-[#1d5b91] hover:underline" title="View all activities">View all →</button>
            </div>
            <div className="mt-4 space-y-2">
              {sectionActivities.slice(0, 3).map((activity) => (
                <div key={activity.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#e7edf4] bg-[#f7f9fc] px-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{activity.title || 'Untitled activity'}</p>
                    <p className="text-xs text-slate-500">{activity.due_date ? `Due ${new Date(activity.due_date).toLocaleDateString()}` : 'No due date'}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${String(activity.status || '').toLowerCase().includes('complete') ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                    {activity.status || 'Active'}
                  </span>
                </div>
              ))}
              {!sectionActivities.length && <p className="text-sm text-slate-500">No activities have been linked to this section yet.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#28415f]">Submission overview</p>
                <p className="text-xs text-slate-500">Monitor assignment completion at a glance</p>
              </div>
              <button type="button" onClick={onViewSubmissions} className="shrink-0 text-xs font-semibold text-[#1d5b91] hover:underline" title="View submissions">View all →</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[#e7edf4] bg-[#f7f9fc] p-3 text-center">
                <p className="text-xs text-slate-500">Submitted</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{submittedCount}</p>
              </div>
              <div className="rounded-xl border border-[#e7edf4] bg-[#f7f9fc] p-3 text-center">
                <p className="text-xs text-slate-500">Missing</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{missingCount}</p>
              </div>
              <div className="rounded-xl border border-[#e7edf4] bg-[#f7f9fc] p-3 text-center">
                <p className="text-xs text-slate-500">Late</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{lateCount}</p>
              </div>
              <div className="rounded-xl border border-[#e7edf4] bg-[#f7f9fc] p-3 text-center">
                <p className="text-xs text-slate-500">Rate</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{completionRate}%</p>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-[#FFC107] transition-all" style={{ width: `${Math.min(100, completionRate)}%` }} />
            </div>
          </div>

          <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#28415f]">Cabinet information</p>
                <p className="text-xs text-slate-500">Assigned to this section</p>
              </div>
              <button type="button" onClick={onViewAccess} className="shrink-0 text-xs font-semibold text-[#1d5b91] hover:underline">View all →</button>
            </div>
            {cabinetStations.length ? (
              <div className="mt-3 space-y-2">
                {cabinetStations.map((item) => (
                  <div key={item.station} className="flex items-center justify-between gap-3 rounded-xl border border-[#e7edf4] bg-[#f7f9fc] px-3 py-2.5">
                    <span className="text-sm font-semibold text-slate-900">{item.station}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'Occupied' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{item.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No cabinet assigned</p>
            )}
          </div>

          <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#28415f]">Recent cabinet access</p>
                <p className="text-xs text-slate-500">Latest records for students in this section</p>
              </div>
              <button type="button" onClick={onViewAccess} className="shrink-0 text-xs font-semibold text-[#1d5b91] hover:underline">View all →</button>
            </div>
            <div className="mt-3 space-y-2">
              {accessLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#e7edf4] bg-[#f7f9fc] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{log.student_name || log.user_name || 'Unknown user'}</p>
                    <p className="text-xs text-slate-500">{log.station || 'Station not recorded'} · {log.access_time ? new Date(log.access_time).toLocaleString() : 'Time unavailable'}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold ${log.status === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>{log.status || 'Unknown'}</span>
                </div>
              ))}
              {!accessLogs.length && <p className="text-sm text-slate-500">No cabinet access records for this section.</p>}
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  )
}

export default function InstructorSections() {
  const navigate = useNavigate()
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [query, setQuery] = useState('')
  const [programFilter, setProgramFilter] = useState('all')
  const [yearLevelFilter, setYearLevelFilter] = useState('all')
  const [academicYearFilter, setAcademicYearFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name-asc')
  const [selectedSection, setSelectedSection] = useState(null)

  const fetchSections = useCallback(async () => {
    try {
      setLoading(true)
      const sectionsRes = await api.get('/sections/')
      const rawSections = Array.isArray(sectionsRes.data) ? sectionsRes.data : sectionsRes.data.results || []
      setSections(rawSections)
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

  useEffect(() => {
    if (!selectedSectionId) return undefined
    const controller = new AbortController()
    const fetchOverview = async () => {
      setOverviewLoading(true)
      setOverviewError('')
      try {
        const response = await api.get(`/sections/${selectedSectionId}/overview/`, { signal: controller.signal })
        if (!controller.signal.aborted) setOverview(response.data)
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('Failed to load section overview:', err)
          setOverviewError('Failed to load this section workspace.')
        }
      } finally {
        if (!controller.signal.aborted) setOverviewLoading(false)
      }
    }
    void fetchOverview()
    return () => controller.abort()
  }, [selectedSectionId])

  const availablePrograms = useMemo(
    () => [...new Set(sections.map((section) => section.program).filter(Boolean))].sort(),
    [sections],
  )

  const availableYears = useMemo(
    () => [...new Set(sections.map((section) => section.year_level).filter(Boolean))].sort(),
    [sections],
  )

  const availableAcademicYears = useMemo(
    () => [...new Set(sections.map((section) => section.academic_year).filter(Boolean))].sort(),
    [sections],
  )

  const filteredSections = useMemo(() => {
    let result = [...sections]

    if (query.trim()) {
      const keyword = query.trim().toLowerCase()
      result = result.filter((section) =>
        [section.subject_code, section.section_name, section.program, section.academic_year, section.instructor_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    if (programFilter !== 'all') {
      result = result.filter((section) => String(section.program || '').toLowerCase() === programFilter.toLowerCase())
    }

    if (yearLevelFilter !== 'all') {
      result = result.filter((section) => String(section.year_level || '').toLowerCase() === yearLevelFilter.toLowerCase())
    }

    if (academicYearFilter !== 'all') {
      result = result.filter((section) => String(section.academic_year || '').toLowerCase() === academicYearFilter.toLowerCase())
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
  }, [sections, query, programFilter, yearLevelFilter, academicYearFilter, statusFilter, sortBy])

  const totalSections = sections.length
  const totalStudents = sections.reduce((sum, section) => sum + (Number(section.student_count) || 0), 0)
  const activeActivities = sections.reduce((sum, section) => sum + (Number(section.activity_count) || 0), 0)
  const pendingReviews = sections.reduce((sum, section) => sum + (Number(section.pending_review_count) || 0), 0)

  const openDrawer = (section) => {
    setSelectedSection(section)
    setOverview(null)
  }

  const handleViewStudents = () => {
    if (!selectedSection) return
    navigate(`/instructor/sections/${selectedSection.section_id ?? selectedSection.id}/students`)
  }

  const handleViewActivities = () => {
    if (!selectedSectionId) return
    navigate(`/instructor/activities?section=${selectedSectionId}`)
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
    { key: 'program', label: 'Program', className: 'min-w-[130px]', render: (value) => value || '—' },
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<BookOpen />} label="Assigned Sections" value={totalSections} subtitle="Classes assigned to you" bgColor="bg-blue-50" textColor="text-blue-900" />
        <StatCard icon={<Users />} label="Students" value={totalStudents} subtitle="Across your sections" bgColor="bg-emerald-50" textColor="text-emerald-900" />
        <StatCard icon={<ClipboardCheck />} label="Activities" value={activeActivities} subtitle="Assigned to your sections" bgColor="bg-sky-50" textColor="text-sky-900" />
        <StatCard icon={<Clock3 />} label="Pending Reviews" value={pendingReviews} subtitle="Awaiting grading" bgColor="bg-amber-50" textColor="text-amber-900" />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex w-full flex-col items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white p-3 md:flex-row">
          <label className="relative block w-full md:max-w-md">
            <span className="sr-only">Search sections</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sections..."
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-4 pl-11 text-sm text-slate-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
              aria-label="Search sections"
            />
          </label>

          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Program</label>
            <select value={programFilter} onChange={(event) => setProgramFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Filter by program">
              <option value="all">All Programs</option>
              {availablePrograms.map((program) => (
                <option key={program} value={program}>{program}</option>
              ))}
            </select>
          </div>

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
              {availableAcademicYears.map((year) => (
                <option key={year} value={year}>{formatAcademicYear(year)}</option>
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

      {selectedSection && (
        <SectionDetailDrawer
          section={overview?.section || selectedSection}
          overview={overview}
          overviewLoading={overviewLoading}
          overviewError={overviewError}
          onClose={() => { setSelectedSection(null); setOverview(null) }}
          onViewStudents={handleViewStudents}
          onViewActivities={handleViewActivities}
          onViewSubmissions={handleViewSubmissions}
          onViewAccess={handleViewAccess}
        />
      )}
    </div>
  )
}
