import { useState, useEffect } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import { ClipboardList, CheckCircle2, Send, Clock } from 'lucide-react'

export default function InstructorDashboard() {
  const [stats, setStats] = useState({
    totalActivities: 0,
    activeActivities: 0,
    totalSubmissions: 0,
    pendingGrading: 0,
  })
  const [recentActivities, setRecentActivities] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    setLoading(true)
    try {
      // Get dashboard statistics
      const dashboardRes = await api.get('/dashboard/')
      const dashboardData = dashboardRes.data

      setStats({
        totalActivities: dashboardData.total_activities || 0,
        activeActivities: dashboardData.total_activities || 0,
        totalSubmissions: dashboardData.total_submissions || 0,
        pendingGrading: dashboardData.pending_grading || 0,
      })

      // Get recent activities
      const activitiesRes = await api.get('/activities/')
      const activities = Array.isArray(activitiesRes.data) 
        ? activitiesRes.data 
        : activitiesRes.data.results || []
      setRecentActivities(activities.slice(0, 5))
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
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
        title="Instructor Dashboard"
        description="Your activities and student submissions"
      />

      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-12 text-center text-[#6B7280] shadow-sm">
          Loading dashboard...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            <StatCard 
              icon={<ClipboardList size={18} />} 
              label="Total Activities" 
              value={stats.totalActivities} 
              subtitle="Activities created"
            />
            <StatCard 
              icon={<CheckCircle2 size={18} />} 
              label="Active Activities" 
              value={stats.activeActivities} 
              subtitle="Currently active"
            />
            <StatCard 
              icon={<Send size={18} />} 
              label="Total Submissions" 
              value={stats.totalSubmissions} 
              subtitle="Submitted by students"
            />
            <StatCard 
              icon={<Clock size={18} />} 
              label="Pending Grading" 
              value={stats.pendingGrading} 
              subtitle="Awaiting your review"
            />
          </div>

          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
            <h2 className="mb-6 text-lg font-semibold text-[#111827]">Recent Activities</h2>
            {recentActivities.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-16 text-center">
                <div className="mb-3 flex justify-center text-4xl text-[#2563EB]">
                  <ClipboardList size={32} />
                </div>
                <p className="text-[#6B7280]">No activities created yet. Start by creating a new activity.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-6 py-3 text-left text-sm font-semibold text-slate-700">Activity</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-slate-700">Due Date</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-slate-700">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentActivities.map((activity) => (
                      <tr key={activity.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-6 py-4 text-sm text-slate-900">{activity.title}</td>
                        <td className="px-6 py-4 text-sm text-slate-600">{formatDate(activity.due_date)}</td>
                        <td className="px-6 py-4 text-sm text-slate-600">{formatDate(activity.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
            <h2 className="mb-6 text-lg font-semibold text-[#111827]">Quick Actions</h2>
            <div className="grid gap-6 md:grid-cols-2">
              <a 
                href="/instructor/activities" 
                className="rounded-[12px] border border-[#E5E7EB] p-6 transition hover:border-[#2563EB] hover:bg-[#F8FAFC]"
              >
                <div className="mb-3 text-[#2563EB]"><ClipboardList size={24} /></div>
                <h3 className="mb-1 font-semibold text-[#111827]">Manage Activities</h3>
                <p className="text-sm text-[#6B7280]">Create, edit, or publish activities</p>
              </a>
              <a 
                href="/instructor/submissions" 
                className="rounded-[12px] border border-[#E5E7EB] p-6 transition hover:border-[#2563EB] hover:bg-[#F8FAFC]"
              >
                <div className="mb-3 text-[#2563EB]"><Send size={24} /></div>
                <h3 className="mb-1 font-semibold text-[#111827]">Grade Submissions</h3>
                <p className="text-sm text-[#6B7280]">Review and grade student work</p>
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
