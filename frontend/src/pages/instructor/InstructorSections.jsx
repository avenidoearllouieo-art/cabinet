import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import { Search, BookOpen, Users, ClipboardCheck, FileText, Clock3, RefreshCcw, UserRound, BadgeCheck, CircleOff, X } from 'lucide-react'

const statusStyles = {
  active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  ongoing: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  empty: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
  archived: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
}

const getStatusBadge = (status, onClick) => {
  if (!status) {
    if (onClick) {
      return (
        <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} className="inline-flex cursor-pointer rounded-full px-3 py-1 text-xs font-semibold text-slate-600" title="View section">—</button>
      )
    }

    return <span className="inline-flex rounded-full px-3 py-1 text-xs font-semibold text-slate-600">—</span>
  }

  const value = String(status).toLowerCase()
  const normalizedValue = value === 'inactive' ? 'empty' : value
  const style = statusStyles[normalizedValue] || 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
  const label = normalizedValue === 'empty' ? 'Empty' : normalizedValue.charAt(0).toUpperCase() + normalizedValue.slice(1)

  if (onClick) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} className={`inline-flex cursor-pointer rounded-full px-3 py-1 text-xs font-semibold ${style}`} title="View section">
        {label}
      </button>
    )
  }

  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${style}`}>{label}</span>
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

const SectionDetailDrawer = ({ section, students, activities, submissions, onClose, onViewStudents, onViewActivities, onViewSubmissions, onExportStudentList, onRefresh }) => {
  const studentCount = Array.isArray(students) ? students.length : 0
  const sectionActivities = Array.isArray(activities) ? activities : []
  const sectionSubmissions = Array.isArray(submissions) ? submissions : []
  const completedActivities = sectionActivities.filter((activity) => String(activity.status || '').toLowerCase().includes('complete') || String(activity.status || '').toLowerCase().includes('graded')).length
  const pendingActivities = Math.max(0, sectionActivities.length - completedActivities)
  const submittedCount = sectionSubmissions.length
  const missingCount = Math.max(0, studentCount - submittedCount)
  const lateCount = sectionSubmissions.filter((submission) => {
    if (!submission.submitted_at || !submission.due_date) return false
    return new Date(submission.submitted_at) > new Date(submission.due_date)
  }).length
  const completionRate = studentCount ? Math.round((submittedCount / studentCount) * 100) : 0
  const latestActivity = sectionActivities[0] || null
  const cabinetName = section?.cabinet_station || section?.cabinet_name || ''

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex bg-slate-950/50">
      <button type="button" className="flex-1" onClick={onClose} aria-label="Close section drawer" />
      <aside className="relative flex w-full max-w-[640px] flex-col overflow-y-auto bg-white p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-100"
          aria-label="Close section drawer"
          title="Close details"
        >
          <X size={18} />
        </button>

        <div className="space-y-6 pt-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
                Section overview
              </span>
              {getStatusBadge(section.status)}
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900">{section.section_name || 'Unnamed Section'}</h2>
            <p className="mt-2 text-sm text-slate-600">{section.section_code || 'Section code not available'}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Section information</p>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div className="flex items-center justify-between gap-2"><span>Program</span><span className="font-medium text-slate-900">{section.program || '—'}</span></div>
                <div className="flex items-center justify-between gap-2"><span>Year level</span><span className="font-medium text-slate-900">{section.year_level || '—'}</span></div>
                <div className="flex items-center justify-between gap-2"><span>Academic year</span><span className="font-medium text-slate-900">{section.academic_year || '—'}</span></div>
                <div className="flex items-center justify-between gap-2"><span>Instructor</span><span className="font-medium text-slate-900">{section.instructor_name || '—'}</span></div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Section analytics</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500"><Users size={16} /> <span className="text-xs">Students</span></div>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{studentCount}</p>
                </div>
                <div className="rounded-xl bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500"><BookOpen size={16} /> <span className="text-xs">Activities</span></div>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{sectionActivities.length}</p>
                </div>
                <div className="rounded-xl bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500"><BadgeCheck size={16} /> <span className="text-xs">Completed</span></div>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{completedActivities}</p>
                </div>
                <div className="rounded-xl bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500"><Clock3 size={16} /> <span className="text-xs">Pending</span></div>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{pendingActivities}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Student preview</p>
                <p className="text-xs text-slate-500">A quick look at enrolled learners</p>
              </div>
              <button type="button" onClick={onViewStudents} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50" title="View all students">View All Students</button>
            </div>
            <div className="mt-4 space-y-2">
              {students.slice(0, 4).map((student) => (
                <div key={student.id || student.student_id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
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

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Latest activities</p>
                <p className="text-xs text-slate-500">Most recent class work for this section</p>
              </div>
              <button type="button" onClick={onViewActivities} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50" title="View all activities">View All Activities</button>
            </div>
            <div className="mt-4 space-y-2">
              {sectionActivities.slice(0, 3).map((activity) => (
                <div key={activity.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
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

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Submission overview</p>
                <p className="text-xs text-slate-500">Monitor assignment completion at a glance</p>
              </div>
              <button type="button" onClick={onViewSubmissions} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50" title="View submissions">View Submissions</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">Submitted</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{submittedCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">Missing</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{missingCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">Late</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{lateCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">Rate</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{completionRate}%</p>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.min(100, completionRate)}%` }} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Cabinet information</p>
            {cabinetName ? (
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div className="flex items-center justify-between gap-2"><span>Cabinet number</span><span className="font-medium text-slate-900">{cabinetName}</span></div>
                <div className="flex items-center justify-between gap-2"><span>Current status</span><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Ready</span></div>
                <div className="flex items-center justify-between gap-2"><span>Today&apos;s access count</span><span className="font-medium text-slate-900">{sectionSubmissions.length || 0}</span></div>
                <div className="flex items-center justify-between gap-2"><span>Latest unlock time</span><span className="font-medium text-slate-900">{latestActivity?.due_date ? new Date(latestActivity.due_date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</span></div>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                <CircleOff size={16} />
                <span>No Cabinet Assigned</span>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={onViewStudents} className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50" title="View students">
              <UserRound size={16} /> View Students
            </button>
            <button type="button" onClick={onViewActivities} className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50" title="View activities">
              <BookOpen size={16} /> View Activities
            </button>
            <button type="button" onClick={onViewSubmissions} className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50" title="View submissions">
              <ClipboardCheck size={16} /> View Submissions
            </button>
            <button type="button" onClick={onExportStudentList} className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50" title="Export student list">
              <FileText size={16} /> Export Student List
            </button>
          </div>
          <button type="button" onClick={onRefresh} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700" title="Refresh section data">
            <RefreshCcw size={16} /> Refresh Data
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  )
}

export default function InstructorSections() {
  const navigate = useNavigate()
  const [sections, setSections] = useState([])
  const [activities, setActivities] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [programFilter, setProgramFilter] = useState('all')
  const [yearLevelFilter, setYearLevelFilter] = useState('all')
  const [academicYearFilter, setAcademicYearFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name-asc')
  const [selectedSection, setSelectedSection] = useState(null)
  const [selectedStudents, setSelectedStudents] = useState([])

  const fetchSections = useCallback(async () => {
    try {
      setLoading(true)
      const [sectionsRes, activitiesRes, submissionsRes] = await Promise.all([
        api.get('/sections/'),
        api.get('/activities/'),
        api.get('/submissions/'),
      ])

      const rawSections = Array.isArray(sectionsRes.data) ? sectionsRes.data : sectionsRes.data.results || []
      const rawActivities = Array.isArray(activitiesRes.data) ? activitiesRes.data : activitiesRes.data.results || []
      const rawSubmissions = Array.isArray(submissionsRes.data) ? submissionsRes.data : submissionsRes.data.results || []

      setSections(rawSections)
      setActivities(rawActivities)
      setSubmissions(rawSubmissions)
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

  const sectionMetrics = useMemo(() => {
    const map = new Map()

    sections.forEach((section) => {
      const sectionId = section.section_id ?? section.id
      const sectionActivities = activities.filter((activity) => {
        const assignedSections = Array.isArray(activity.assigned_sections) ? activity.assigned_sections : []
        const activitySectionId = activity.section ?? activity.section_id
        return String(activitySectionId) === String(sectionId) || assignedSections.includes(sectionId) || assignedSections.includes(String(sectionId))
      })

      const sectionSubmissions = submissions.filter((submission) => {
        const activityId = submission.activity
        return sectionActivities.some((activity) => String(activity.id) === String(activityId))
      })

      const completedActivities = sectionActivities.filter((activity) => {
        const status = String(activity.status || '').toLowerCase()
        return status.includes('complete') || status.includes('graded') || status.includes('submitted')
      }).length

      const pendingReviews = sectionSubmissions.filter((submission) => submission.score === null || submission.score === undefined).length
      const latestActivity = [...sectionActivities].sort((left, right) => new Date(right.updated_at || right.created_at || right.due_date || 0) - new Date(left.updated_at || left.created_at || left.due_date || 0))[0]

      map.set(sectionId, {
        activityCount: sectionActivities.length,
        completedActivities,
        pendingActivities: Math.max(0, sectionActivities.length - completedActivities),
        pendingReviews,
        latestActivity,
        lastUpdated: latestActivity?.updated_at || latestActivity?.created_at || latestActivity?.due_date || section.updated_at || section.created_at || null,
      })
    })

    return map
  }, [sections, activities, submissions])

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
        [section.section_code, section.section_name, section.program, section.academic_year, section.instructor_name]
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
      const leftMetrics = sectionMetrics.get(left.section_id ?? left.id) || {}
      const rightMetrics = sectionMetrics.get(right.section_id ?? right.id) || {}

      switch (sortBy) {
        case 'name-desc':
          return String(right.section_name || '').localeCompare(String(left.section_name || ''))
        case 'students-desc':
          return (Number(right.student_count || 0) || 0) - (Number(left.student_count || 0) || 0)
        case 'students-asc':
          return (Number(left.student_count || 0) || 0) - (Number(right.student_count || 0) || 0)
        case 'activities-desc':
          return (Number(rightMetrics.activityCount || 0) || 0) - (Number(leftMetrics.activityCount || 0) || 0)
        case 'updated-desc':
          return new Date(rightMetrics.lastUpdated || 0) - new Date(leftMetrics.lastUpdated || 0)
        case 'name-asc':
        default:
          return String(left.section_name || '').localeCompare(String(right.section_name || ''))
      }
    })

    return result
  }, [sections, query, programFilter, yearLevelFilter, academicYearFilter, statusFilter, sortBy, sectionMetrics])

  const totalSections = sections.length
  const totalStudents = sections.reduce((sum, section) => sum + (parseInt(section.student_count) || 0), 0)
  const activeActivities = sections.reduce((sum, section) => {
    const metrics = sectionMetrics.get(section.section_id ?? section.id) || {}
    return sum + (metrics.activityCount || 0)
  }, 0)
  const pendingReviews = sections.reduce((sum, section) => {
    const metrics = sectionMetrics.get(section.section_id ?? section.id) || {}
    return sum + (metrics.pendingReviews || 0)
  }, 0)

  const openDrawer = async (section) => {
    setSelectedSection(section)
    try {
      const sectionId = section.section_id ?? section.id
      const response = await api.get(`/users/?section=${sectionId}&role=student`)
      const studentList = Array.isArray(response.data) ? response.data : response.data.results || []
      setSelectedStudents(studentList)
    } catch (err) {
      console.error('Failed to load section students:', err)
      setSelectedStudents([])
    }
  }

  const handleViewStudents = () => {
    if (!selectedSection) return
    navigate(`/instructor/sections/${selectedSection.section_id ?? selectedSection.id}/students`)
  }

  const handleViewActivities = () => {
    navigate('/instructor/activities')
  }

  const handleViewSubmissions = () => {
    navigate('/instructor/submissions')
  }

  const handleExportStudentList = () => {
    if (!selectedSection || !selectedStudents.length) return

    const header = ['Student Name', 'Student ID', 'Email']
    const rows = selectedStudents.map((student) => [
      `${student.first_name || ''} ${student.last_name || ''}`.trim(),
      student.student_id || '',
      student.email || '',
    ])

    const csvRows = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(selectedSection.section_code || selectedSection.section_name || 'section').replace(/\s+/g, '-').toLowerCase()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const refreshSections = () => {
    setSelectedSection(null)
    setSelectedStudents([])
    fetchSections()
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Sections" description="Manage your assigned classes with a polished, modern dashboard experience." />

      <div className="grid gap-6 xl:grid-cols-4 md:grid-cols-2">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex w-fit items-center justify-center rounded-xl bg-blue-50 p-3 text-blue-900"><BookOpen size={20} /></div>
          </div>
          <div className="mt-6">
            <p className="text-sm font-medium text-slate-500">Assigned Sections</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{totalSections}</p>
            <p className="mt-1 text-sm text-slate-500">Classes assigned to you</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex w-fit items-center justify-center rounded-xl bg-emerald-50 p-3 text-emerald-900"><Users size={20} /></div>
          </div>
          <div className="mt-6">
            <p className="text-sm font-medium text-slate-500">Total Students</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{totalStudents}</p>
            <p className="mt-1 text-sm text-slate-500">Enrolled learners across your sections</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex w-fit items-center justify-center rounded-xl bg-violet-50 p-3 text-violet-900"><ClipboardCheck size={20} /></div>
          </div>
          <div className="mt-6">
            <p className="text-sm font-medium text-slate-500">Active Activities</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{activeActivities}</p>
            <p className="mt-1 text-sm text-slate-500">Current class tasks and assignments</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex w-fit items-center justify-center rounded-xl bg-amber-50 p-3 text-amber-900"><Clock3 size={20} /></div>
          </div>
          <div className="mt-6">
            <p className="text-sm font-medium text-slate-500">Pending Reviews</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{pendingReviews}</p>
            <p className="mt-1 text-sm text-slate-500">Items waiting for grading or review</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-[14px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-[16px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex w-full flex-col items-center justify-between gap-4 rounded-xl border border-slate-100 bg-white p-4 shadow-sm md:flex-row">
          <label className="relative block w-full md:max-w-md">
            <span className="sr-only">Search sections</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by section code, section name, program, or academic year..."
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-11 text-sm text-slate-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
              aria-label="Search sections"
            />
          </label>

          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Program</label>
            <select value={programFilter} onChange={(event) => setProgramFilter(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Filter by program">
              <option value="all">All Programs</option>
              {availablePrograms.map((program) => (
                <option key={program} value={program}>{program}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Year Level</label>
            <select value={yearLevelFilter} onChange={(event) => setYearLevelFilter(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Filter by year level">
              <option value="all">All Levels</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Academic Year</label>
            <select value={academicYearFilter} onChange={(event) => setAcademicYearFilter(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Filter by academic year">
              <option value="all">All Years</option>
              {availableAcademicYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Status</label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Filter by status">
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="ongoing">Ongoing</option>
              <option value="empty">Empty</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Sort By</label>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500" aria-label="Sort sections">
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
          <div className="flex items-center justify-center rounded-[14px] border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-sm text-slate-500">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
              <span>Loading your sections…</span>
            </div>
          </div>
        ) : !filteredSections.length ? (
          <div className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-3xl shadow-sm">📚</div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">No Sections Assigned</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">You currently have no assigned sections. Please contact your administrator if you believe this is incorrect.</p>
            <button type="button" onClick={refreshSections} className="mt-6 inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700" title="Refresh sections">
              <RefreshCcw size={16} /> Refresh
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 hidden overflow-x-auto lg:block">
              <table className="min-w-full border-separate border-spacing-y-2">
                <thead>
                  <tr>
                    <th className="sticky top-0 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Section</th>
                    <th className="sticky top-0 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Program</th>
                    <th className="sticky top-0 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Year</th>
                    <th className="sticky top-0 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Students</th>
                    <th className="sticky top-0 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Activities</th>
                    <th className="sticky top-0 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Pending</th>
                    <th className="sticky top-0 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Last Activity</th>
                    <th className="sticky top-0 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Academic Year</th>
                    <th className="sticky top-0 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Status</th>
                    
                  </tr>
                </thead>
                <tbody>
                  {filteredSections.map((section) => {
                    const sectionId = section.section_id ?? section.id
                    const metrics = sectionMetrics.get(sectionId) || {}

                    return (
                      <tr key={sectionId} className="cursor-pointer rounded-2xl bg-white shadow-sm transition hover:bg-slate-50" onClick={() => openDrawer(section)}>
                        <td className="rounded-l-2xl px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><BookOpen size={18} /></div>
                            <div>
                              <p className="font-semibold text-slate-900">{section.section_name || 'Unnamed Section'}</p>
                              <p className="text-sm text-slate-500">{section.section_code || '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-600">{section.program || '—'}</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{section.year_level || '—'}</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{section.student_count || 0} Students</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{metrics.activityCount || 0} Activities</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{metrics.pendingReviews || 0} Pending</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{metrics.latestActivity?.title ? `${metrics.latestActivity.title}` : 'No activity'}<br /><span className="text-xs text-slate-400">{formatRelativeTime(metrics.lastUpdated)}</span></td>
                        <td className="px-4 py-4 text-sm text-slate-600">{section.academic_year || '—'}</td>
                        <td className="px-4 py-4">{getStatusBadge(section.status, () => openDrawer(section))}</td>
                        
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid gap-4 lg:hidden">
              {filteredSections.map((section) => {
                const sectionId = section.section_id ?? section.id
                const metrics = sectionMetrics.get(sectionId) || {}

                return (
                  <div key={sectionId} className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm" onClick={() => openDrawer(section)}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-slate-900">{section.section_name || 'Unnamed Section'}</p>
                        <p className="text-sm text-slate-500">{section.section_code || '—'} • {section.program || '—'}</p>
                      </div>
                      {getStatusBadge(section.status, () => openDrawer(section))}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-3 text-sm text-slate-600">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Students</p>
                        <p className="mt-1 font-semibold text-slate-900">{section.student_count || 0}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Activities</p>
                        <p className="mt-1 font-semibold text-slate-900">{metrics.activityCount || 0}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Pending</p>
                        <p className="mt-1 font-semibold text-slate-900">{metrics.pendingReviews || 0}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                      <div>
                        <p className="font-medium text-slate-900">{metrics.latestActivity?.title || 'No activity'}</p>
                        <p className="text-xs text-slate-500">{formatRelativeTime(metrics.lastUpdated)}</p>
                      </div>
                      
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {selectedSection && (
        <SectionDetailDrawer
          section={selectedSection}
          students={selectedStudents}
          activities={activities.filter((activity) => {
            const assignedSections = Array.isArray(activity.assigned_sections) ? activity.assigned_sections : []
            const activitySectionId = activity.section ?? activity.section_id
            const selectedSectionId = selectedSection.section_id ?? selectedSection.id
            return String(activitySectionId) === String(selectedSectionId) || assignedSections.includes(selectedSectionId) || assignedSections.includes(String(selectedSectionId))
          })}
          submissions={submissions.filter((submission) => {
            const activityId = submission.activity
            return activities.some((activity) => {
              const assignedSections = Array.isArray(activity.assigned_sections) ? activity.assigned_sections : []
              const activitySectionId = activity.section ?? activity.section_id
              const selectedSectionId = selectedSection.section_id ?? selectedSection.id
              return String(activity.id) === String(activityId) && (String(activitySectionId) === String(selectedSectionId) || assignedSections.includes(selectedSectionId) || assignedSections.includes(String(selectedSectionId)))
            })
          })}
          onClose={() => setSelectedSection(null)}
          onViewStudents={handleViewStudents}
          onViewActivities={handleViewActivities}
          onViewSubmissions={handleViewSubmissions}
          onExportStudentList={handleExportStudentList}
          onRefresh={refreshSections}
        />
      )}
    </div>
  )
}
