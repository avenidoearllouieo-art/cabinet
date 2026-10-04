import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api.js'
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
  const [user, setUser] = useState(null)
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

  const fetchDashboardData = useCallback(async () => {
    setLoading(true)
    try {
      // Get current user
      const userStr = localStorage.getItem('user')
      if (userStr) {
        setUser(JSON.parse(userStr))
      }

      // Get dashboard statistics
      const dashboardRes = await api.get('/dashboard/')
      const dashboardData = dashboardRes.data

      setStats({
        totalActivities: dashboardData.total_activities || 0,
        activeActivities: dashboardData.total_activities || 0,
        totalSubmissions: dashboardData.total_submissions || 0,
        pendingGrading: dashboardData.pending_grading || 0,
      })

      // Get recent activities and sort for upcoming deadlines
      const activitiesRes = await api.get('/activities/')
      const activities = Array.isArray(activitiesRes.data) 
        ? activitiesRes.data 
        : activitiesRes.data.results || []
      
      // Sort by created date descending for recent activities
      const recent = activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5)
      setRecentActivities(recent)

      // Sort by due date for upcoming deadlines (only those with future due dates)
      const now = new Date()
      const upcoming = activities
        .filter(activity => activity.due_date && new Date(activity.due_date) > now)
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
        .slice(0, 5)
      setUpcomingDeadlines(upcoming)

      // Get recent submissions
      const submissionsRes = await api.get('/submissions/', {
        params: { ordering: '-submitted_at', limit: 5 }
      })
      const submissions = Array.isArray(submissionsRes.data) 
        ? submissionsRes.data 
        : submissionsRes.data.results || []
      setRecentSubmissions(submissions.slice(0, 5))
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
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
    if (!dueDate) return null
    const days = Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24))
    if (days < 0) return `Overdue by ${Math.abs(days)}d`
    if (days === 0) return 'Due today'
    if (days === 1) return 'Due tomorrow'
    return `Due in ${days}d`
  }

  const recentActivityColumns = [
    { key: 'title', label: 'Activity', className: 'min-w-[220px]', render: (value) => value || 'Untitled activity' },
    { key: 'section_name', label: 'Section', className: 'min-w-[140px]', render: (value) => value || 'No section' },
    { key: 'created_at', label: 'Created', className: 'min-w-[150px]', render: (value) => formatDateShort(value) },
    { key: 'due_date', label: 'Due Date', className: 'min-w-[150px]', render: (value) => formatDateShort(value) },
    {
      key: 'due_status',
      label: 'Due Status',
      className: 'min-w-[130px]',
      render: (_value, activity) => activity.due_date ? getDaysUntilDue(activity.due_date) : 'No due date',
    },
  ]

  const upcomingDeadlineColumns = [
    { key: 'title', label: 'Activity', className: 'min-w-[220px]', render: (value) => value || 'Untitled activity' },
    { key: 'section_name', label: 'Section', className: 'min-w-[140px]', render: (value) => value || 'No section' },
    { key: 'due_date', label: 'Due Date', className: 'min-w-[150px]', render: (value) => formatDateShort(value) },
    { key: 'time_remaining', label: 'Time Remaining', className: 'min-w-[150px]', render: (_value, activity) => getDaysUntilDue(activity.due_date) },
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

  return (
    <div className="space-y-5">
      <div>
        <PageHeader
          title="Instructor Dashboard"
          description="Your activities and student submissions"
        />
        {user && (
          <p className="mt-3 text-sm text-slate-600">
            Welcome back, <span className="font-semibold text-slate-900">{user.first_name} {user.last_name}</span>! Here's a summary of your activities and submissions.
          </p>
        )}
      </div>
      <CabinetStationStatus detailLevel="instructor" />

      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-12 text-center text-[#6B7280] shadow-sm">
          Loading dashboard...
        </div>
      ) : (
        <>
          {/* Statistics Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard 
              icon={<ClipboardList size={20} />} 
              label="Total Activities" 
              value={stats.totalActivities} 
              subtitle="Created by you"
              bgColor="bg-amber-50"
              textColor="text-amber-700"
            />
            <StatCard 
              icon={<TrendingUp size={20} />} 
              label="Active Activities" 
              value={stats.activeActivities} 
              subtitle="Open now"
              bgColor="bg-emerald-50"
              textColor="text-emerald-700"
            />
            <StatCard 
              icon={<Send size={20} />} 
              label="Submissions"
              value={stats.totalSubmissions} 
              subtitle="Received from students"
              bgColor="bg-blue-50"
              textColor="text-blue-700"
            />
            <StatCard 
              icon={<Award size={20} />} 
              label="Pending Grading" 
              value={stats.pendingGrading} 
              subtitle="Awaiting grading"
              bgColor="bg-amber-50"
              textColor="text-amber-700"
            />
          </div>

          <div className="space-y-5">
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-[#102a4c]">Recent Activities</h2>
              <DataTable columns={recentActivityColumns} rows={recentActivities} variant="instructor" showActions={false} emptyMessage="No activities created yet." />
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-[#102a4c]">Upcoming Deadlines</h2>
              <DataTable columns={upcomingDeadlineColumns} rows={upcomingDeadlines} variant="instructor" showActions={false} emptyMessage="No upcoming deadlines." />
            </section>

            <section className="space-y-3">
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
