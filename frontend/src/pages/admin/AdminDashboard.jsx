import { useState, useEffect } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import { ClipboardList, Users, Send, TrendingUp } from 'lucide-react'

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalAssignments: 0,
    totalSubmissions: 0,
    participationRate: 92,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('access')
      const headers = { Authorization: `Bearer ${token}` }

      const usersRes = await api.get('/users/')
      const users = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data.results || []
      const students = users.filter((u) => u.role === 'student')

      const activitiesRes = await api.get('/activities/')
      const activities = Array.isArray(activitiesRes.data) ? activitiesRes.data : activitiesRes.data.results || []

      const submissionsRes = await api.get('/submissions/')
      const submissions = Array.isArray(submissionsRes.data) ? submissionsRes.data : submissionsRes.data.results || []

      setStats({
        totalStudents: students.length,
        totalAssignments: activities.length,
        totalSubmissions: submissions.length,
        participationRate: 92,
      })
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard Overview"
        description="System-wide metrics and recent activity"
      />

      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-12 text-center text-[#6B7280] shadow-sm">
          Loading dashboard...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={<Users size={18} />} label="Total Students" value={stats.totalStudents} subtitle="All enrolled users" />
          <StatCard icon={<ClipboardList size={18} />} label="Total Assignments" value={stats.totalAssignments} subtitle="Active assignments" />
          <StatCard icon={<Send size={18} />} label="Total Submissions" value={stats.totalSubmissions} subtitle="All submissions" />
          <StatCard icon={<TrendingUp size={18} />} label="Participation Rate" value={`${stats.participationRate}%`} subtitle="Student engagement" />
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
        <h2 className="mb-6 text-lg font-semibold text-[#111827]">Recent Submissions - Needs Grading</h2>
        <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-16 text-center">
          <div className="mb-3 flex justify-center text-4xl text-[#2563EB]">
            <ClipboardList size={32} />
          </div>
          <p className="text-[#6B7280]">All caught up! No pending submissions to grade.</p>
        </div>
      </div>

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 shadow-sm">
        <h2 className="mb-6 text-lg font-semibold text-[#111827]">Quick Actions</h2>
        <div className="grid gap-6 md:grid-cols-3">
          <a href="/admin/users" className="rounded-[12px] border border-[#E5E7EB] p-6 transition hover:border-[#2563EB] hover:bg-[#F8FAFC]">
            <div className="mb-3 text-[#2563EB]"><Users size={24} /></div>
            <h3 className="mb-1 font-semibold text-[#111827]">Manage Users</h3>
            <p className="text-sm text-[#6B7280]">Add, edit, or remove users</p>
          </a>
          <a href="/admin/activities" className="rounded-[12px] border border-[#E5E7EB] p-6 transition hover:border-[#2563EB] hover:bg-[#F8FAFC]">
            <div className="mb-3 text-[#2563EB]"><ClipboardList size={24} /></div>
            <h3 className="mb-1 font-semibold text-[#111827]">Manage Activities</h3>
            <p className="text-sm text-[#6B7280]">Create and manage activities</p>
          </a>
          <a href="/admin/sections" className="rounded-[12px] border border-[#E5E7EB] p-6 transition hover:border-[#2563EB] hover:bg-[#F8FAFC]">
            <div className="mb-3 text-[#2563EB]"><TrendingUp size={24} /></div>
            <h3 className="mb-1 font-semibold text-[#111827]">Manage Sections</h3>
            <p className="text-sm text-[#6B7280]">Organize course sections</p>
          </a>
        </div>
      </div>
    </div>
  )
}
