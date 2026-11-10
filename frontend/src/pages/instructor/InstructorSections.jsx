import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import StatusBadge from '../../components/StatusBadge'
import DataTable from '../../components/DataTable'
import { Search, BookOpen, Users, ClipboardCheck, Clock3, BadgeCheck, X } from 'lucide-react'

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

const SectionDetailDrawer = ({ section, overview, overviewLoading, overviewError, onClose, onViewStudent, onViewActivity, onViewStudents, onViewActivities, onViewSubmissions, onViewAccess }) => {
  const [activeTab, setActiveTab] = useState('overview')
  const drawerRef = useRef(null)
  const closeButtonRef = useRef(null)
  const metrics = overview?.counts || {}
  const students = overview?.students || []
  const sectionActivities = overview?.activities || []
  const recentSubmissions = overview?.recent_submissions || []
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
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus({ preventScroll: true }), 0)
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(drawerRef.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') || [])]
        .filter((element) => element.getClientRects().length)
      if (!focusable.length) {
        event.preventDefault()
        drawerRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex bg-[#071f41]/55 backdrop-blur-[2px]">
      <button type="button" className="flex-1" onClick={onClose} aria-label="Close section drawer" />
      <aside ref={drawerRef} tabIndex={-1} className="relative flex h-full min-h-0 w-full max-w-[640px] flex-col overflow-hidden border-l border-[#dbe5f0] bg-[#f7f9fc] shadow-[-18px_0_50px_rgba(0,43,91,0.18)]" role="dialog" aria-modal="true" aria-labelledby="instructor-section-overview-title">
        <header className="sticky top-0 z-20 shrink-0 border-b border-[#dbe5f0] border-l-4 border-l-[#ffc107] bg-[#eef4fa] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#082b53]">Section overview</span>
                {getStatusBadge(sectionData.status)}
              </div>
              <h2 id="instructor-section-overview-title" className="mt-3 break-words text-xl font-bold tracking-tight text-[#102a4c] sm:text-2xl">{sectionData.section_name || 'Unnamed Section'}</h2>
              <p className="mt-1 text-sm font-medium text-[#64748b]">{sectionData.subject_code || 'Subject Code not available'}</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#dbe5f0] bg-white text-[#526780] transition hover:bg-[#f3f6fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc107]"
              aria-label="Close section drawer"
              title="Close details"
            >
              <X size={18} />
            </button>
          </div>
          <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-[#dbe5f0]" role="tablist" aria-label="Section details">
            {[
              ['overview', 'Overview'],
              ['students', 'Students'],
              ['activities', 'Activities'],
              ['submissions', 'Submissions'],
              ['cabinet', 'Cabinet Access'],
            ].map(([tab, label]) => (
              <button key={tab} id={`section-tab-${tab}`} type="button" role="tab" aria-selected={activeTab === tab} aria-controls={`section-tabpanel-${tab}`} onClick={() => setActiveTab(tab)} className={`shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition sm:text-sm ${activeTab === tab ? 'border-[#ffc107] text-[#082b53]' : 'border-transparent text-[#64748b] hover:text-[#102a4c]'}`}>
                {label}
              </button>
            ))}
          </nav>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="space-y-4">
          {overviewLoading && <p className="text-sm text-slate-500">Loading this section&apos;s workspace…</p>}
          {overviewError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{overviewError}</p>}
          {activeTab === 'overview' && <section id="section-tabpanel-overview" role="tabpanel" aria-labelledby="section-tab-overview" className="space-y-4">
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
                  <p className="mt-1 text-2xl font-bold text-[#102a4c]">{activityCount}</p>
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
          </section>}

          {activeTab === 'students' && <section id="section-tabpanel-students" role="tabpanel" aria-labelledby="section-tab-students" className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#28415f]">Student preview</p>
                <p className="text-xs text-slate-500">A quick look at enrolled learners</p>
              </div>
              <button type="button" onClick={onViewStudents} className="shrink-0 text-xs font-semibold text-[#1d5b91] hover:underline" title="View all students">View all →</button>
            </div>
            <div className="mt-4 space-y-2">
              {students.slice(0, 4).map((student) => (
                <button key={student.id || student.student_id} type="button" onClick={() => onViewStudent(student.id)} disabled={!student.id} className="flex w-full items-center justify-between rounded-xl border border-[#e7edf4] bg-[#f7f9fc] px-3 py-2.5 text-left transition hover:border-[#ffc107] disabled:cursor-default">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dcecf9] text-sm font-bold text-[#1d5b91]">
                      {(student.first_name?.[0] || student.last_name?.[0] || 'S').toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{`${student.first_name || ''} ${student.last_name || ''}`.trim() || 'Unnamed Student'}</p>
                      <p className="text-xs text-slate-500">{student.student_id || 'Student ID not set'}</p>
                    </div>
                  </div>
                </button>
              ))}
              {studentCount > 4 && <p className="text-sm text-slate-500">+{studentCount - 4} more learners</p>}
              {!studentCount && <p className="text-sm text-slate-500">No students are currently linked to this section.</p>}
            </div>
          </section>}

          {activeTab === 'activities' && <section id="section-tabpanel-activities" role="tabpanel" aria-labelledby="section-tab-activities" className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#28415f]">Latest activities</p>
                <p className="text-xs text-slate-500">Most recent class work for this section</p>
              </div>
              <button type="button" onClick={onViewActivities} className="shrink-0 text-xs font-semibold text-[#1d5b91] hover:underline" title="View all activities">View all →</button>
            </div>
            <div className="mt-4 space-y-2">
              {sectionActivities.slice(0, 3).map((activity) => (
                <button key={activity.id} type="button" onClick={() => onViewActivity(activity.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#e7edf4] bg-[#f7f9fc] px-3 py-3 text-left transition hover:border-[#ffc107]">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{activity.title || 'Untitled activity'}</p>
                    <p className="text-xs text-slate-500">{activity.due_date ? `Due ${new Date(activity.due_date).toLocaleDateString()}` : 'No due date'}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${String(activity.status || '').toLowerCase().includes('complete') ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                    {activity.status || 'Active'}
                  </span>
                </button>
              ))}
              {!sectionActivities.length && <p className="text-sm text-slate-500">No activities have been linked to this section yet.</p>}
            </div>
          </section>}

          {activeTab === 'submissions' && <section id="section-tabpanel-submissions" role="tabpanel" aria-labelledby="section-tab-submissions" className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
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
            <div className="mt-5 border-t border-[#e7edf4] pt-4">
              <p className="text-sm font-bold text-[#28415f]">Recent submissions</p>
              {recentSubmissions.length ? (
                <ul className="mt-3 space-y-2">
                  {recentSubmissions.slice(0, 5).map((submission) => (
                    <li key={submission.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e7edf4] bg-[#f7f9fc] px-3 py-2">
                      <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{submission.student_name || 'Unknown student'} · {submission.activity_title || 'Unknown activity'}</p><p className="text-xs text-slate-500">{submission.submitted_at ? new Date(submission.submitted_at).toLocaleString() : 'Date unavailable'}</p></div>
                      <StatusBadge status={submission.status || 'submitted'} label={submission.score == null ? submission.status || 'Submitted' : `Graded · ${submission.score}`} />
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-slate-500">No submissions have been recorded for this section.</p>}
            </div>
          </section>}

          {activeTab === 'cabinet' && (
            <section id="section-tabpanel-cabinet" role="tabpanel" aria-labelledby="section-tab-cabinet" className="space-y-4">
          <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#28415f]">Stations used by assigned activities</p>
                <p className="text-xs text-slate-500">Current station availability, not access history</p>
              </div>
            </div>
            {cabinetStations.length ? (
              <div className="mt-3 space-y-2">
                {cabinetStations.map((item) => (
                  <div key={item.station} className="flex items-center justify-between gap-3 rounded-xl border border-[#e7edf4] bg-[#f7f9fc] px-3 py-2.5">
                    <span className="text-sm font-semibold text-slate-900">{item.station}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'Occupied' ? 'bg-amber-50 text-amber-800' : item.status === 'Available' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>{item.status || 'Unknown'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No station is currently assigned by an activity. Historical access is listed below.</p>
            )}
          </div>

          <div className="rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#28415f]">Historical cabinet access</p>
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
            </section>
          )}
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

  const closeDrawer = useCallback(() => {
    setSelectedSection(null)
    setOverview(null)
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

      <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
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

        {(query || programFilter !== 'all' || yearLevelFilter !== 'all' || academicYearFilter !== 'all' || statusFilter !== 'all' || sortBy !== 'name-asc') && (
          <div className="mb-4 flex justify-end">
            <button type="button" onClick={() => { setQuery(''); setProgramFilter('all'); setYearLevelFilter('all'); setAcademicYearFilter('all'); setStatusFilter('all'); setSortBy('name-asc') }} className="min-h-9 rounded-lg border border-[#dbe5f0] bg-white px-3 py-1.5 text-sm font-semibold text-[#082b53] hover:bg-[#eef4fa]">Reset filters</button>
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

      {selectedSection && (
        <SectionDetailDrawer
          section={overview?.section || selectedSection}
          overview={overview}
          overviewLoading={overviewLoading}
          overviewError={overviewError}
          onClose={closeDrawer}
          onViewStudent={handleViewStudent}
          onViewActivity={handleViewActivity}
          onViewStudents={handleViewStudents}
          onViewActivities={handleViewActivities}
          onViewSubmissions={handleViewSubmissions}
          onViewAccess={handleViewAccess}
        />
      )}
    </div>
  )
}
