import { useState, useEffect } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import { 
  ClipboardList, 
  CheckCircle2, 
  Send, 
  Clock,
  AlertCircle,
  TrendingUp,
  Award,
  Calendar,
  User
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

  const fetchDashboardData = async () => {
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
  }

  useEffect(() => {
    fetchDashboardData()
  }, [])

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
    if (!submission) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Not Submitted</span>
    const status = submission.submission_status || submission.status || ''
    const statusLower = String(status).toLowerCase()
    
    if (statusLower.includes('graded')) {
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"><CheckCircle2 size={14} /> Graded</span>
    } else if (statusLower.includes('late')) {
      return <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800"><AlertCircle size={14} /> Late</span>
    }
    return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800"><Clock size={14} /> Submitted</span>
  }

  const isActivityOverdue = (dueDate) => {
    return dueDate && new Date(dueDate) < new Date()
  }

  const getDaysUntilDue = (dueDate) => {
    if (!dueDate) return null
    const days = Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24))
    if (days < 0) return `Overdue by ${Math.abs(days)}d`
    if (days === 0) return 'Due today'
    if (days === 1) return 'Due tomorrow'
    return `Due in ${days}d`
  }

  return (
    <div className="space-y-8">
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

      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-12 text-center text-[#6B7280] shadow-sm">
          Loading dashboard...
        </div>
      ) : (
        <>
          {/* Statistics Cards */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            <StatCard 
              icon={<ClipboardList size={20} />} 
              label="Total Activities" 
              value={stats.totalActivities} 
              subtitle="Activities created"
              bgColor="bg-blue-50"
              textColor="text-blue-600"
              borderColor="border-blue-200"
            />
            <StatCard 
              icon={<TrendingUp size={20} />} 
              label="Active Activities" 
              value={stats.activeActivities} 
              subtitle="Currently active"
              bgColor="bg-emerald-50"
              textColor="text-emerald-600"
              borderColor="border-emerald-200"
            />
            <StatCard 
              icon={<Send size={20} />} 
              label="Total Submissions" 
              value={stats.totalSubmissions} 
              subtitle="Submitted by students"
              bgColor="bg-purple-50"
              textColor="text-purple-600"
              borderColor="border-purple-200"
            />
            <StatCard 
              icon={<Award size={20} />} 
              label="Pending Grading" 
              value={stats.pendingGrading} 
              subtitle="Awaiting your review"
              bgColor="bg-orange-50"
              textColor="text-orange-600"
              borderColor="border-orange-200"
            />
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* Left Column - Recent Activities and Upcoming Deadlines */}
            <div className="lg:col-span-2 space-y-8">
              {/* Recent Activities Section */}
              <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
                <div className="mb-6 flex items-center gap-3">
                  <ClipboardList size={24} className="text-blue-600" />
                  <h2 className="text-lg font-semibold text-[#111827]">Recent Activities</h2>
                </div>
                {recentActivities.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-12 text-center">
                    <div className="mb-3 flex justify-center text-4xl text-[#9CA3AF]">
                      <ClipboardList size={40} />
                    </div>
                    <p className="font-medium text-[#6B7280]">No activities created yet</p>
                    <p className="mt-1 text-sm text-[#9CA3AF]">Start by creating a new activity to get began.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentActivities.map((activity) => (
                      <div key={activity.id} className="flex items-start justify-between rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-slate-100 transition">
                        <div className="flex-1">
                          <h3 className="font-medium text-slate-900">{activity.title}</h3>
                          <p className="mt-1 text-sm text-slate-600">{activity.section_name || 'No section'}</p>
                          <div className="mt-2 flex items-center gap-4 text-xs text-slate-600">
                            <span className="flex items-center gap-1">
                              <Calendar size={14} /> {formatDateShort(activity.due_date) || 'No due date'}
                            </span>
                            {activity.due_date && (
                              <span className={`font-semibold ${isActivityOverdue(activity.due_date) ? 'text-red-600' : 'text-emerald-600'}`}>
                                {getDaysUntilDue(activity.due_date)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upcoming Deadlines Section */}
              <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
                <div className="mb-6 flex items-center gap-3">
                  <Clock size={24} className="text-orange-600" />
                  <h2 className="text-lg font-semibold text-[#111827]">Upcoming Deadlines</h2>
                </div>
                {upcomingDeadlines.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-12 text-center">
                    <div className="mb-3 flex justify-center text-4xl text-[#9CA3AF]">
                      <Calendar size={40} />
                    </div>
                    <p className="font-medium text-[#6B7280]">No upcoming deadlines</p>
                    <p className="mt-1 text-sm text-[#9CA3AF]">All your activities have passed their due dates.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {upcomingDeadlines.map((activity) => (
                      <div key={activity.id} className="flex items-center justify-between rounded-lg border-l-4 border-l-orange-500 border border-slate-200 bg-slate-50 p-4 hover:bg-slate-100 transition">
                        <div className="flex-1">
                          <h3 className="font-medium text-slate-900">{activity.title}</h3>
                          <p className="mt-1 text-sm text-slate-600">{activity.section_name || 'No section'}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-orange-600">{getDaysUntilDue(activity.due_date)}</p>
                          <p className="mt-1 text-xs text-slate-600">{formatDateShort(activity.due_date)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Recent Submissions and Quick Actions */}
            <div className="space-y-8">
              {/* Recent Submissions Section */}
              <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
                <div className="mb-6 flex items-center gap-3">
                  <Send size={24} className="text-purple-600" />
                  <h2 className="text-lg font-semibold text-[#111827]">Recent Submissions</h2>
                </div>
                {recentSubmissions.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-8 text-center">
                    <div className="mb-3 flex justify-center text-4xl text-[#9CA3AF]">
                      <Send size={36} />
                    </div>
                    <p className="font-medium text-[#6B7280]">No submissions yet</p>
                    <p className="mt-1 text-xs text-[#9CA3AF]">Submissions from students will appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentSubmissions.map((submission) => (
                      <div key={submission.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100 transition">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="truncate font-medium text-slate-900 text-sm">{submission.activity_title}</p>
                            <p className="mt-1 truncate text-xs text-slate-600">{submission.student_name} {submission.student_last_name}</p>
                          </div>
                          <div className="ml-2 flex-shrink-0">
                            {getSubmissionStatusBadge(submission)}
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{formatDate(submission.submitted_at)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Actions */}
              <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
                <div className="mb-6 flex items-center gap-3">
                  <TrendingUp size={24} className="text-emerald-600" />
                  <h2 className="text-lg font-semibold text-[#111827]">Quick Actions</h2>
                </div>
                <div className="space-y-3">
                  <a 
                    href="/instructor/activities" 
                    className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 transition hover:bg-blue-100 hover:border-blue-300"
                  >
                    <div className="rounded-lg bg-blue-600 p-2 text-white">
                      <ClipboardList size={18} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">Manage Activities</h3>
                      <p className="text-xs text-slate-600">Create, edit, or publish</p>
                    </div>
                  </a>
                  <a 
                    href="/instructor/submissions" 
                    className="flex items-center gap-3 rounded-lg border border-purple-200 bg-purple-50 p-4 transition hover:bg-purple-100 hover:border-purple-300"
                  >
                    <div className="rounded-lg bg-purple-600 p-2 text-white">
                      <Send size={18} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">Grade Submissions</h3>
                      <p className="text-xs text-slate-600">Review and grade work</p>
                    </div>
                  </a>
                  <a 
                    href="/instructor/sections" 
                    className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 transition hover:bg-emerald-100 hover:border-emerald-300"
                  >
                    <div className="rounded-lg bg-emerald-600 p-2 text-white">
                      <User size={18} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">Manage Sections</h3>
                      <p className="text-xs text-slate-600">View and manage students</p>
                    </div>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
