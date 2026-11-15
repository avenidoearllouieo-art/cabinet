import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck, BookOpen, CalendarClock, Clock3, Search, Users } from 'lucide-react'
import api from '../../services/api.js'
import AcademicFileAttachments from '../files/AcademicFileAttachments.jsx'
import Modal from '../Modal.jsx'
import StatusBadge from '../StatusBadge.jsx'
import { fetchAllResults } from '../../services/paginatedResults.js'

const tabs = [
  ['overview', 'Overview'],
  ['students', 'Students'],
  ['activities', 'Activities'],
  ['submissions', 'Submissions'],
  ['cabinet', 'Cabinet Access'],
]
const emptyResults = []

const displayValue = (value) => value === null || value === undefined || String(value).trim() === '' ? 'Not recorded' : String(value)
const displayCount = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? 'Not available' : Number(value)
const sectionIdOf = (section) => section?.section_id ?? section?.id

function formatDate(value, withTime = false) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone: 'Asia/Manila',
  }).format(date)
}

function SectionInfo({ section, stations }) {
  const cabinet = stations.map((station) => station.station).filter(Boolean).join(', ')
    || section.assigned_cabinet || section.cabinet_station || section.cabinet_name
  const details = [
    ['Section name', section.section_name],
    ['Section code', section.subject_code],
    ['Program', section.program],
    ['Year level', section.year_level],
    ['Academic year', section.academic_year],
    ['Assigned instructor', section.instructor_name],
    ...(cabinet ? [['Assigned cabinet', cabinet]] : []),
  ]

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-base font-bold text-[#082B53]">Section Information</h3>
      <dl className="mt-4 divide-y divide-slate-100">
        {details.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.2fr)] gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            <dt className="text-slate-500">{label}</dt>
            <dd className="break-words text-right font-semibold text-slate-800">{displayValue(value)}</dd>
          </div>
        ))}
        {!cabinet && <div className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.2fr)] gap-3 py-2.5 text-sm"><dt className="text-slate-500">Assigned cabinet</dt><dd className="text-right font-semibold text-slate-500">Not assigned</dd></div>}
      </dl>
    </section>
  )
}

function Metric({ icon: Icon, label, value, detail }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-600"><Icon size={16} aria-hidden="true" /><span>{label}</span></div>
      <p className="mt-2 break-words text-2xl font-bold text-[#082B53]">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  )
}

function EmptyRow({ columns, message }) {
  return <tr><td colSpan={columns} className="px-4 py-10 text-center text-sm text-slate-500">{message}</td></tr>
}

function SectionOverviewModal({
  isOpen,
  section,
  role = 'instructor',
  onClose,
  onEditSection,
  onAssignInstructor,
  onDeleteSection,
  onViewStudent,
  onViewActivity,
  onViewStudents,
  onViewActivities,
  onViewSubmissions,
  onViewAccess,
}) {
  const sectionId = sectionIdOf(section)
  const [activeTab, setActiveTab] = useState('overview')
  const [overview, setOverview] = useState(null)
  const [overviewError, setOverviewError] = useState('')
  const [records, setRecords] = useState({})
  const [studentSearch, setStudentSearch] = useState('')
  const [studentSort, setStudentSort] = useState('name')
  const requestedTabsRef = useRef(new Set())
  const mountedRef = useRef(false)
  const sectionData = overview?.section || section || {}
  const counts = overview?.counts || {}
  const students = records.students?.results || emptyResults
  const activities = records.activities?.results || []
  const submissions = records.submissions?.results || emptyResults
  const accessLogs = records.cabinet?.results || []
  const stations = overview?.cabinet_stations || []
  const submissionCounts = useMemo(() => {
    const result = new Map()
    submissions.forEach((submission) => result.set(submission.activity, (result.get(submission.activity) || 0) + 1))
    return result
  }, [submissions])
  const filteredStudents = useMemo(() => {
    const keyword = studentSearch.trim().toLowerCase()
    const matching = students.filter((student) => [student.first_name, student.last_name, student.student_id, student.email, student.section_name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword)))
    return matching.sort((left, right) => {
      if (studentSort === 'student_id') return String(left.student_id || '').localeCompare(String(right.student_id || ''))
      if (studentSort === 'email') return String(left.email || '').localeCompare(String(right.email || ''))
      return `${left.last_name || ''} ${left.first_name || ''}`.localeCompare(`${right.last_name || ''} ${right.first_name || ''}`)
    })
  }, [students, studentSearch, studentSort])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!isOpen || !sectionId) return undefined
    const controller = new AbortController()
    api.get(`/sections/${sectionId}/overview/`, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setOverview(response.data)
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error('Failed to load section overview:', error)
          setOverviewError('Section information could not be loaded.')
        }
      })
    return () => controller.abort()
  }, [isOpen, sectionId])

  useEffect(() => {
    const endpoints = {
      students: ['/users/', { role: 'student', section: sectionId }],
      activities: ['/activities/', { section: sectionId }],
      submissions: ['/submissions/', { section: sectionId }],
      cabinet: ['/access-logs/', { 'user__section': sectionId }],
    }
    const tabsToLoad = activeTab === 'activities' ? ['activities', 'submissions'] : [activeTab]
    if (!isOpen || !sectionId) return
    tabsToLoad.forEach((tab) => {
      const request = endpoints[tab]
      if (!request || requestedTabsRef.current.has(tab)) return
      requestedTabsRef.current.add(tab)
      setRecords((current) => ({ ...current, [tab]: { loading: true, results: [] } }))
      fetchAllResults(api, request[0], request[1])
        .then(({ results }) => {
          if (mountedRef.current) setRecords((current) => ({ ...current, [tab]: { loaded: true, results } }))
        })
        .catch((error) => {
          if (mountedRef.current) {
            console.error(`Failed to load section ${tab}:`, error)
            setRecords((current) => ({ ...current, [tab]: { loaded: true, results: [], error: 'These section records could not be loaded.' } }))
          }
        })
    })
  }, [activeTab, isOpen, sectionId])

  if (!section || !isOpen) return null

  const recordState = records[activeTab]
  const metric = (key) => displayCount(counts[key])
  const expected = Number(counts.expected)
  const submitted = Number(counts.submitted)
  const completionRate = counts.expected === null || counts.expected === undefined || counts.submitted === null || counts.submitted === undefined
    ? 'Not available'
    : `${expected ? Math.round((submitted / expected) * 100) : 0}%`
  const panel = (id, children) => <section id={`section-tabpanel-${id}`} role="tabpanel" aria-labelledby={`section-tab-${id}`} className="space-y-4">{children}</section>
  const closeActions = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
      {role === 'admin' && onDeleteSection && <button type="button" onClick={onDeleteSection} className="min-h-10 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Delete Section</button>}
      {role === 'admin' && onAssignInstructor && <button type="button" onClick={onAssignInstructor} className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#082B53] hover:bg-slate-50">Assign Instructor</button>}
      {role === 'admin' && onEditSection && <button type="button" onClick={onEditSection} className="min-h-10 rounded-lg bg-[#FFBE0B] px-4 py-2 text-sm font-bold text-[#082B53] hover:bg-amber-400">Edit Section</button>}
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      title="Section Overview"
      description={`${sectionData.section_name || 'Unnamed section'} · ${sectionData.subject_code || 'No section code'}`}
      headerIcon={<BookOpen size={20} aria-hidden="true" />}
      headerActions={<StatusBadge status={sectionData.status || 'unknown'} label={sectionData.status || 'Unknown'} />}
      onClose={onClose}
      maxWidth="min(90vw, 1320px)"
      footer={closeActions}
      stepper={(
        <nav className="shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-3 sm:px-6" role="tablist" aria-label="Section details">
          <div className="flex min-w-max gap-1">
            {tabs.map(([tab, label]) => (
              <button key={tab} id={`section-tab-${tab}`} type="button" role="tab" aria-selected={activeTab === tab} aria-controls={`section-tabpanel-${tab}`} onClick={() => setActiveTab(tab)} className={`min-h-12 shrink-0 border-b-[3px] px-3 text-sm font-semibold transition-colors ${activeTab === tab ? 'border-[#FFBE0B] text-[#082B53]' : 'border-transparent text-slate-500 hover:text-[#082B53]'}`}>
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}
    >
      <div className="space-y-4 sm:space-y-5">
        {overviewError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{overviewError}</p>}
        {recordState?.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{recordState.error}</p>}
        {activeTab === 'overview' && panel('overview', <div className="grid gap-4 xl:grid-cols-2">
          <SectionInfo section={sectionData} stations={stations} />
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="text-base font-bold text-[#082B53]">Section Analytics</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Metric icon={Users} label="Students" value={metric('students')} />
              <Metric icon={BookOpen} label="Activities" value={metric('activities')} />
              <Metric icon={BadgeCheck} label="Submitted" value={metric('submitted')} detail={counts.expected == null ? 'Expected: Not available' : `Expected: ${metric('expected')}`} />
              <Metric icon={Clock3} label="Missing" value={metric('missing')} />
              <Metric icon={CalendarClock} label="Late" value={metric('late')} />
              <Metric icon={Clock3} label="Awaiting Review" value={metric('pending_review')} />
            </div>
            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-[#EAF2FB] px-4 py-3">
              <span className="text-sm font-semibold text-[#082B53]">Completion Rate</span>
              <span className="text-xl font-bold text-[#082B53]">{completionRate}</span>
            </div>
          </section>
        </div>)}

        {activeTab === 'students' && panel('students', <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div><h3 className="text-base font-bold text-[#082B53]">Students</h3><p className="mt-1 text-sm text-slate-500">{recordState?.loaded ? `${students.length} enrolled` : 'Loading student records'}</p>{onViewStudents && <button type="button" onClick={onViewStudents} className="mt-1 text-sm font-semibold text-[#1d5b91] hover:underline">View full roster</button>}</div>
            <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto]">
              <label className="relative"><span className="sr-only">Search students</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search students" aria-label="Search students" className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#082B53] focus:ring-2 focus:ring-[#082B53]/15" /></label>
              <label><span className="sr-only">Sort students</span><select value={studentSort} onChange={(event) => setStudentSort(event.target.value)} aria-label="Sort students" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#082B53]"><option value="name">Name</option><option value="student_id">Student ID</option><option value="email">Email</option></select></label>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500"><tr><th className="px-4 py-3">Student Name</th><th className="px-4 py-3">Student ID</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Section</th><th className="px-4 py-3">Registration Status</th><th className="px-4 py-3">Cabinet Access Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {recordState?.loading && <EmptyRow columns={6} message="Loading student records…" />}
                {recordState?.loaded && filteredStudents.map((student) => (
                  <tr key={student.id}>
                    <td className="px-4 py-3 font-semibold text-slate-800">{onViewStudent ? <button type="button" onClick={() => onViewStudent(student.id)} className="text-left text-[#082B53] hover:underline">{`${student.first_name || ''} ${student.last_name || ''}`.trim() || 'Unnamed student'}</button> : `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'Unnamed student'}</td>
                    <td className="px-4 py-3 text-slate-600">{displayValue(student.student_id)}</td>
                    <td className="px-4 py-3 text-slate-600">{displayValue(student.email)}</td>
                    <td className="px-4 py-3 text-slate-600">{displayValue(student.section_name || sectionData.section_name)}</td>
                    <td className="px-4 py-3">{student.nfc_registered == null ? <span className="text-slate-500">Not available</span> : <StatusBadge status={student.nfc_registered ? 'active' : 'inactive'} label={student.nfc_registered ? 'Registered' : 'Not registered'} />}</td>
                    <td className="px-4 py-3">{student.last_access_status ? <StatusBadge status={student.last_access_status} label={`${student.last_access_status}${student.last_access_time ? ` · ${formatDate(student.last_access_time, true)}` : ''}`} /> : <span className="text-slate-500">No access recorded</span>}</td>
                  </tr>
                ))}
                {recordState?.loaded && !filteredStudents.length && <EmptyRow columns={6} message={studentSearch ? 'No students match this search.' : 'No students are enrolled in this section.'} />}
              </tbody>
            </table>
          </div>
        </section>)}

        {activeTab === 'activities' && panel('activities', <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><div><h3 className="text-base font-bold text-[#082B53]">Section Activities</h3><p className="mt-1 text-sm text-slate-500">{recordState?.loaded ? `${activities.length} activities` : 'Loading activity records'}</p></div>{onViewActivities && <button type="button" onClick={onViewActivities} className="text-sm font-semibold text-[#1d5b91] hover:underline">Open activities</button>}</div>
          <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500"><tr><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Due Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Submissions</th></tr></thead><tbody className="divide-y divide-slate-100">
            {recordState?.loading && <EmptyRow columns={5} message="Loading activities…" />}
            {recordState?.loaded && activities.map((activity) => <tr key={activity.id}><td className="px-4 py-3 font-semibold text-[#082B53]">{onViewActivity ? <button type="button" onClick={() => onViewActivity(activity.id)} className="text-left hover:underline">{displayValue(activity.title)}</button> : displayValue(activity.title)}</td><td className="px-4 py-3 text-slate-600">{displayValue(activity.activity_type)}</td><td className="px-4 py-3 text-slate-600">{formatDate(activity.due_date)}</td><td className="px-4 py-3"><StatusBadge status={activity.status || 'unknown'} label={displayValue(activity.status)} /></td><td className="px-4 py-3 text-slate-600">{records.submissions?.loaded ? submissionCounts.get(activity.id) || 0 : records.submissions?.error ? 'Not available' : 'Loading…'}</td></tr>)}
            {recordState?.loaded && !activities.length && <EmptyRow columns={5} message="No activities are assigned to this section." />}
          </tbody></table></div>
        </section>)}

        {activeTab === 'submissions' && panel('submissions', <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><div><h3 className="text-base font-bold text-[#082B53]">Section Submissions</h3><p className="mt-1 text-sm text-slate-500">{recordState?.loaded ? `${submissions.length} submissions` : 'Loading submission records'}</p></div>{onViewSubmissions && <button type="button" onClick={onViewSubmissions} className="text-sm font-semibold text-[#1d5b91] hover:underline">Open submissions</button>}</div>
          <div className="overflow-x-auto"><table className="w-full min-w-[940px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500"><tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Submission Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Grade</th><th className="px-4 py-3">Files</th></tr></thead><tbody className="divide-y divide-slate-100">
            {recordState?.loading && <EmptyRow columns={6} message="Loading submissions…" />}
            {recordState?.loaded && submissions.map((submission) => <tr key={submission.id}><td className="px-4 py-3 font-medium text-slate-800">{`${submission.student_name || ''} ${submission.student_last_name || ''}`.trim() || displayValue(submission.student_id)}</td><td className="px-4 py-3 text-slate-700">{displayValue(submission.activity_title)}</td><td className="px-4 py-3 text-slate-600">{formatDate(submission.submitted_at, true)}</td><td className="px-4 py-3"><StatusBadge status={submission.submission_status || submission.status || 'unknown'} label={displayValue(submission.submission_status || submission.status)} /></td><td className="px-4 py-3 text-slate-700">{submission.score == null ? 'Not graded' : `${submission.score}${submission.max_score == null ? '' : ` / ${submission.max_score}`}`}</td><td className="px-4 py-3">{submission.files?.length ? <details className="min-w-52"><summary className="cursor-pointer font-semibold text-[#082B53]">Attachments ({submission.files.length})</summary><div className="mt-2"><AcademicFileAttachments attachments={submission.files} kind="submission" /></div></details> : <span className="text-slate-500">No files</span>}</td></tr>)}
            {recordState?.loaded && !submissions.length && <EmptyRow columns={6} message="No submissions are recorded for this section." />}
          </tbody></table></div>
        </section>)}

        {activeTab === 'cabinet' && panel('cabinet', <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><div><h3 className="text-base font-bold text-[#082B53]">Cabinet Access</h3><p className="mt-1 text-sm text-slate-500">{recordState?.loaded ? `${accessLogs.length} access records` : 'Loading access records'}</p></div>{onViewAccess && <button type="button" onClick={onViewAccess} className="text-sm font-semibold text-[#1d5b91] hover:underline">View access logs</button>}</div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500"><tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">Date and Time</th><th className="px-4 py-3">Cabinet / Station</th><th className="px-4 py-3">Access Result</th></tr></thead><tbody className="divide-y divide-slate-100">
            {recordState?.loading && <EmptyRow columns={4} message="Loading cabinet access…" />}
            {recordState?.loaded && accessLogs.map((log) => <tr key={log.id}><td className="px-4 py-3 font-medium text-slate-800">{log.student_name || `${log.user_name || ''} ${log.user_last_name || ''}`.trim() || displayValue(log.student_id)}</td><td className="px-4 py-3 text-slate-600">{formatDate(log.access_time, true)}</td><td className="px-4 py-3 text-slate-700">{displayValue(log.cabinet_name || log.station)}</td><td className="px-4 py-3"><StatusBadge status={log.status || 'unknown'} label={displayValue(log.access_result || log.status)} /></td></tr>)}
            {recordState?.loaded && !accessLogs.length && <EmptyRow columns={4} message="No cabinet access records are available for this section." />}
          </tbody></table></div>
        </section>)}
      </div>
    </Modal>
  )
}

export default SectionOverviewModal
