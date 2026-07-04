import { useState, useEffect } from 'react'
import { BookOpen, Clock, CheckCircle2, LogIn, Send } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'

export default function StudentDashboard() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalActivities: 0,
    totalSubmissions: 0,
    pendingActivities: 0,
    submittedActivities: 0,
    cabinetAccessToday: 0,
  })
  const [upcomingActivities, setUpcomingActivities] = useState([])
  const [recentSubmissions, setRecentSubmissions] = useState([])
  const [recentAccessLogs, setRecentAccessLogs] = useState([])

  useEffect(() => {
    fetchDashboard()
  }, [])

  const fetchDashboard = async () => {
    setLoading(true)
    try {
      const response = await api.get('/dashboard/')
      const dashboard = response.data

      setStats({
        totalActivities: dashboard.total_activities || 0,
        totalSubmissions: dashboard.submitted_activities || 0,
        pendingActivities: dashboard.pending_activities || 0,
        submittedActivities: dashboard.submitted_activities || 0,
        cabinetAccessToday: dashboard.cabinet_access_today || 0,
      })

      setUpcomingActivities(Array.isArray(dashboard.upcoming_activities) ? dashboard.upcoming_activities : [])
      setRecentSubmissions(Array.isArray(dashboard.recent_submissions) ? dashboard.recent_submissions : [])
      setRecentAccessLogs(Array.isArray(dashboard.recent_access_logs) ? dashboard.recent_access_logs : [])
    } catch (err) {
      console.error('Failed to load student dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (value) => {
    if (!value) return '—'
    try {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value))
    } catch (err) {
      return String(value)
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Student Dashboard"
        description="Track your assignments, submissions, and cabinet access activity"
      />

      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-12 text-center text-[#6B7280] shadow-sm">
          Loading dashboard...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<BookOpen size={18} />}
              label="Assigned Activities"
              value={stats.totalActivities}
              subtitle="Open and upcoming tasks"
            />
            <StatCard
              icon={<Send size={18} />}
              label="Submitted Activities"
              value={stats.submittedActivities}
              subtitle="Activities you submitted"
            />
            <StatCard
              icon={<Clock size={18} />}
              label="Pending Activities"
              value={stats.pendingActivities}
              subtitle="Activities still pending"
            />
            <StatCard
              icon={<LogIn size={18} />}
              label="Cabinet Access Today"
              value={stats.cabinetAccessToday}
              subtitle="Today’s access attempts"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#111827]">Upcoming Activities</h2>
                  <p className="mt-1 text-sm text-[#6B7280]">Deadlines and tasks you need to complete.</p>
                </div>
              </div>

              {upcomingActivities.length === 0 ? (
                <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-16 text-center">
                  <p className="text-[#6B7280]">No upcoming activities found. Check back later.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="px-6 py-3 text-left text-sm font-semibold text-slate-700">Activity</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-slate-700">Due Date</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-slate-700">Max Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingActivities.map((activity) => (
                        <tr key={activity.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-6 py-4 text-sm text-slate-900">{activity.title}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{formatDate(activity.due_date)}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{activity.max_score ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#111827]">Recent Submissions</h2>
                  <p className="mt-1 text-sm text-[#6B7280]">Review the status of your latest work.</p>
                </div>
              </div>

              <DataTable
                columns={[
                  { key: 'activity_title', label: 'Activity' },
                  { key: 'submitted_at', label: 'Submitted At', render: (value) => formatDate(value) },
                  { key: 'score', label: 'Score', render: (value) => (value !== null && value !== undefined ? value : 'Pending') },
                  { key: 'status', label: 'Status' },
                ]}
                data={recentSubmissions}
                loading={loading}
                showActions={false}
              />
            </div>
          </div>

          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-[#111827]">Recent Cabinet Access</h2>
                <p className="mt-1 text-sm text-[#6B7280]">Your most recent cabinet access attempts.</p>
              </div>
            </div>

            <DataTable
              columns={[
                { key: 'access_time', label: 'Time', render: (value) => formatDate(value) },
                { key: 'status', label: 'Status' },
                { key: 'cabinet_name', label: 'Cabinet' },
                { key: 'reason', label: 'Reason' },
              ]}
              data={recentAccessLogs}
              loading={loading}
              showActions={false}
            />
          </div>
        </>
      )}
    </div>
  )
}
