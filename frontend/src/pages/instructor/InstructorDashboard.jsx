import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import { fetchAllResults } from '../../services/paginatedResults.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/StatusBadge'
import CabinetStationStatus from '../../components/CabinetStationStatus'
import { 
  ClipboardList, 
  CheckCircle2, 
  Send, 
  Clock,
  AlertCircle,
  TrendingUp,
  Award,
} from 'lucide-react'

export default function InstructorDashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [sectionNamesById, setSectionNamesById] = useState({})
  const [stats, setStats] = useState({
    totalActivities: 0,
    activeActivities: 0,
    totalSubmissions: 0,
    pendingGrading: 0,
  })
  const [recentActivities, setRecentActivities] = useState([])
  const [upcomingDeadlines, setUpcomingDeadlines] = useState([])
  const [recentSubmissions, setRecentSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const fetchDashboardData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      // Get current user
      const userStr = localStorage.getItem('user')
      if (userStr) {
        setUser(JSON.parse(userStr))
      }

      // Get dashboard statistics
      const [dashboardRes, activityPage, sectionPage, submissionsRes] = await Promise.all([
        api.get('/dashboard/'),
        fetchAllResults(api, '/activities/', { page_size: 100 }),
        fetchAllResults(api, '/sections/', { page_size: 100 }),
        api.get('/submissions/', { params: { ordering: '-submitted_at' } }),
      ])
      const dashboardData = dashboardRes.data
      const activities = activityPage.results
      const sections = sectionPage.results
      const activeStatuses = new Set(['active', 'ongoing', 'published'])

      setStats({
        totalActivities: dashboardData.total_activities || 0,
        activeActivities: activities.filter((activity) => activeStatuses.has(String(activity.status || '').toLowerCase())).length,
        totalSubmissions: dashboardData.total_submissions || 0,
        pendingGrading: dashboardData.pending_grading || 0,
      })
      setSectionNamesById(Object.fromEntries(sections.map((section) => [String(section.id), section.section_name])))

      const recent = [...activities].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)).slice(0, 5)
      setRecentActivities(recent)

      const now = new Date()
      const upcoming = activities
        .filter((activity) => activity.due_date && Date.parse(activity.due_date) > now.getTime())
        .sort((a, b) => Date.parse(a.due_date) - Date.parse(b.due_date))
        .slice(0, 5)
      setUpcomingDeadlines(upcoming)

      const submissions = Array.isArray(submissionsRes.data) 
        ? submissionsRes.data 
        : submissionsRes.data.results || []
      setRecentSubmissions(submissions.slice(0, 5))
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
      setLoadError('Dashboard information could not be refreshed. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchDashboardData, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchDashboardData])

  const formatDate = (value) => {
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

  const formatDateShort = (value) => {
    if (!value) return '—'
    try {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'short',
      }).format(new Date(value))
    } catch {
      return String(value)
    }
  }

  const getSubmissionStatusBadge = (submission) => {
    if (!submission) return <StatusBadge status="not submitted" label="Not Submitted" />
    const status = submission.submission_status || submission.status || ''
    const statusLower = String(status).toLowerCase()
    if (statusLower.includes('graded')) return <StatusBadge status="graded" icon={CheckCircle2} />
    if (statusLower.includes('late')) return <StatusBadge status="late" icon={AlertCircle} />
    return <StatusBadge status="submitted" icon={Clock} />
  }

  const getDaysUntilDue = (dueDate) => {
    if (!dueDate) return { label: 'No due date', tone: 'neutral' }
    const due = new Date(dueDate)
    if (Number.isNaN(due.getTime())) return { label: 'Date unavailable', tone: 'neutral' }
    const now = new Date()
    if (due < now) return { label: `Overdue by ${Math.max(1, Math.ceil((now - due) / 86400000))}d`, tone: 'danger' }
    if (due.toDateString() === now.toDateString()) return { label: 'Due today', tone: 'warning' }
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (due.toDateString() === tomorrow.toDateString()) return { label: 'Due tomorrow', tone: 'warning' }
    const days = Math.ceil((due - now) / 86400000)
    return { label: `Due in ${days}d`, tone: days <= 3 ? 'warning' : 'info' }
  }

  const getAssignedSectionNames = (activity) => {
    const ids = Array.isArray(activity.assigned_sections) ? activity.assigned_sections : []
    const names = ids.map((section) => {
      const id = typeof section === 'object' ? section.id ?? section.section_id : section
      return sectionNamesById[String(id)]
    }).filter(Boolean)
    if (names.length) return names.join(', ')
    return activity.section_name || sectionNamesById[String(activity.section)] || 'No section'
  }

  const recentActivityColumns = [
    { key: 'title', label: 'Activity', className: 'min-w-[220px]', render: (value) => value || 'Untitled activity' },
    { key: 'section_name', label: 'Assigned Sections', className: 'min-w-[140px]', render: (_value, activity) => getAssignedSectionNames(activity) },
    { key: 'created_at', label: 'Created', className: 'min-w-[150px]', render: (value) => formatDateShort(value) },
    { key: 'due_date', label: 'Due Date', className: 'min-w-[150px]', render: (value) => formatDateShort(value) },
    {
      key: 'due_status',
      label: 'Due Status',
      className: 'min-w-[130px]',
      render: (_value, activity) => {
        const dueStatus = getDaysUntilDue(activity.due_date)
        return <StatusBadge label={dueStatus.label} tone={dueStatus.tone} />
      },
    },
    { key: 'status', label: 'Status', className: 'min-w-[110px]', render: (value) => <StatusBadge status={value || 'unknown'} label={value || 'Unknown'} /> },
  ]

  const upcomingDeadlineColumns = [
    { key: 'title', label: 'Activity', className: 'min-w-[220px]', render: (value) => value || 'Untitled activity' },
    { key: 'section_name', label: 'Assigned Sections', className: 'min-w-[140px]', render: (_value, activity) => getAssignedSectionNames(activity) },
    { key: 'due_date', label: 'Due Date', className: 'min-w-[150px]', render: (value) => formatDateShort(value) },
    { key: 'time_remaining', label: 'Time Remaining', className: 'min-w-[150px]', render: (_value, activity) => {
      const dueStatus = getDaysUntilDue(activity.due_date)
      return <StatusBadge label={dueStatus.label} tone={dueStatus.tone} />
    } },
  ]

  const recentSubmissionColumns = [
    {
      key: 'student_name',
      label: 'Student',
      className: 'min-w-[180px]',
      render: (value, submission) => `${value || ''} ${submission.student_last_name || ''}`.trim() || '—',
    },
    { key: 'activity_title', label: 'Activity', className: 'min-w-[220px]', render: (value) => value || '—' },
    { key: 'submitted_at', label: 'Submitted', className: 'min-w-[170px]', render: (value) => formatDate(value) },
    { key: 'status', label: 'Status', className: 'min-w-[120px]', render: (_value, submission) => getSubmissionStatusBadge(submission) },
    { key: 'score', label: 'Score', className: 'min-w-[90px]', render: (value) => value ?? 'Pending' },
  ]
  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.username
  const dashboardDescription = displayName
    ? `Welcome back, ${displayName}. Here's a summary of your activities and submissions.`
    : 'Your activities and student submissions.'

  return (
    <div className="space-y-5">
      <PageHeader compact title="Instructor Dashboard" description={dashboardDescription} />
      <CabinetStationStatus detailLevel="instructor" />

      {loadError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}<button type="button" onClick={fetchDashboardData} className="ml-3 font-semibold underline">Retry</button></div>}
      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-12 text-center text-[#6B7280] shadow-sm">
          Loading dashboard...
        </div>
      ) : (
        <>
          {/* Statistics Cards */}
          <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
            <StatCard 
              icon={<ClipboardList size={20} />} 
              label="Total Activities" 
              value={stats.totalActivities} 
              subtitle="Created by you"
              mobileSubtitle="Created"
              bgColor="bg-amber-50"
              textColor="text-amber-700"
            />
            <StatCard 
              icon={<TrendingUp size={20} />} 
              label="Active Activities" 
              value={stats.activeActivities} 
              subtitle="Open now"
              mobileSubtitle="Open"
              bgColor="bg-emerald-50"
              textColor="text-emerald-700"
            />
            <StatCard 
              icon={<Send size={20} />} 
              label="Submissions"
              value={stats.totalSubmissions} 
              subtitle="Received from students"
              mobileSubtitle="Received"
              bgColor="bg-blue-50"
              textColor="text-blue-700"
            />
            <StatCard 
              icon={<Award size={20} />} 
              label="Pending Grading" 
              value={stats.pendingGrading} 
              subtitle="Awaiting grading"
              mobileSubtitle="To grade"
              bgColor="bg-amber-50"
              textColor="text-amber-700"
            />
          </div>

          <div className="space-y-4 sm:space-y-5">
            <section className="space-y-2 sm:space-y-3">
              <h2 className="text-lg font-semibold text-[#102a4c]">Recent Activities</h2>
              <DataTable columns={recentActivityColumns} rows={recentActivities} variant="instructor" showActions={false} onRowClick={(activity) => activity.id && navigate(`/instructor/activities/${activity.id}`)} emptyMessage="No activities created yet." />
            </section>

            <section className="space-y-2 sm:space-y-3">
              <h2 className="text-lg font-semibold text-[#102a4c]">Upcoming Deadlines</h2>
              <DataTable columns={upcomingDeadlineColumns} rows={upcomingDeadlines} variant="instructor" showActions={false} onRowClick={(activity) => activity.id && navigate(`/instructor/activities/${activity.id}`)} emptyMessage="No upcoming deadlines." />
            </section>

            <section className="space-y-2 sm:space-y-3">
              <h2 className="text-lg font-semibold text-[#102a4c]">Recent Submissions</h2>
              <DataTable columns={recentSubmissionColumns} rows={recentSubmissions} variant="instructor" showActions={false} emptyMessage="No submissions yet." />
            </section>

            <nav className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[#dbe5f0] pt-4" aria-label="Instructor management pages">
              <a href="/instructor/sections" className="text-sm font-semibold text-[#002b5b] hover:text-[#1d5b91]">View Sections</a>
              <a href="/instructor/activities" className="text-sm font-semibold text-[#002b5b] hover:text-[#1d5b91]">View Activities</a>
              <a href="/instructor/submissions" className="text-sm font-semibold text-[#002b5b] hover:text-[#1d5b91]">View Submissions</a>
            </nav>
          </div>
        </>
      )}
    </div>
  )
}
