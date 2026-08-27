import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import { Activity, ClipboardList, Radio, Send, ShieldCheck, Users } from 'lucide-react'

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return String(value)
  }
}

export default function AdminDashboard() {
  const [stats, setStats] = useState({ totalStudents: 0, totalAssignments: 0, totalSubmissions: 0, totalAccessLogs: 0 })
  const [recentAccessLogs, setRecentAccessLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true)
      try {
        const [usersRes, activitiesRes, submissionsRes, dashboardRes] = await Promise.all([
          api.get('/users/'),
          api.get('/activities/'),
          api.get('/submissions/'),
          api.get('/dashboard/'),
        ])
        const users = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data.results || []
        const activities = Array.isArray(activitiesRes.data) ? activitiesRes.data : activitiesRes.data.results || []
        const submissions = Array.isArray(submissionsRes.data) ? submissionsRes.data : submissionsRes.data.results || []
        const dashboard = dashboardRes.data || {}

        setStats({
          totalStudents: users.filter((user) => user.role === 'student').length,
          totalAssignments: activities.length,
          totalSubmissions: submissions.length,
          totalAccessLogs: dashboard.total_access_logs || 0,
        })
        setRecentAccessLogs(Array.isArray(dashboard.recent_access_logs) ? dashboard.recent_access_logs : [])
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader title="Operations Overview" description="Live cabinet activity and system readiness." />

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">Loading operations dashboard…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard icon={Users} title="Enrolled Students" value={stats.totalStudents} trendText="Registered system users" iconBg="bg-blue-50" iconColor="text-blue-900" />
            <SummaryCard icon={ClipboardList} title="Active Activities" value={stats.totalAssignments} trendText="Published coursework" trendColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-900" />
            <SummaryCard icon={Send} title="Submissions" value={stats.totalSubmissions} trendText="Files received" iconBg="bg-violet-50" iconColor="text-violet-900" />
            <SummaryCard icon={ShieldCheck} title="Access Records" value={stats.totalAccessLogs} trendText="Recorded NFC and login events" iconBg="bg-amber-50" iconColor="text-amber-900" />
          </div>

          <div className="grid gap-6">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-taptrack-navy"><Radio size={18} className="text-taptrack-gold" /> Recent access activity</p>
                  <p className="mt-1 text-sm text-slate-500">Latest events recorded by TapTrack.</p>
                </div>
                <Link to="/admin/access-logs" className="inline-flex min-h-11 items-center rounded-lg border border-taptrack-navy px-4 text-sm font-semibold text-taptrack-navy transition hover:bg-taptrack-navy hover:text-white">View logs</Link>
              </div>
              <div className="divide-y divide-slate-100">
                {recentAccessLogs.length ? recentAccessLogs.slice(0, 5).map((log, index) => {
                  const success = String(log.status).toLowerCase() === 'success'
                  return (
                    <div key={log.id || index} className={`flex min-h-14 items-center justify-between gap-4 px-6 py-3 ${index % 2 ? 'bg-taptrack-stripe' : 'bg-white'} hover:bg-slate-100`}>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-taptrack-navy">{log.user?.name?.trim() || 'Unregistered card'}</p>
                        <p className="text-xs text-slate-500">{log.user?.student_id || 'NFC access event'} · {formatDate(log.access_time)}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${success ? 'bg-emerald-50 text-[#16A34A]' : 'bg-red-50 text-[#B91C1C]'}`}>{success ? 'Success' : 'Failed'}</span>
                    </div>
                  )
                }) : <div className="px-6 py-12 text-center text-sm text-slate-500">No access activity has been recorded yet.</div>}
              </div>
            </section>
          </div>

          <section className="grid gap-4 md:grid-cols-3">
            <Link to="/admin/access-logs" className="flex min-h-24 items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 text-taptrack-navy shadow-sm transition hover:border-taptrack-gold hover:shadow-md"><ShieldCheck className="text-taptrack-gold" size={24} /><span><strong className="block">Access monitoring</strong><span className="text-sm text-slate-500">Review NFC authentication outcomes.</span></span></Link>
            <Link to="/admin/cabinet-events" className="flex min-h-24 items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 text-taptrack-navy shadow-sm transition hover:border-taptrack-gold hover:shadow-md"><Activity className="text-taptrack-gold" size={24} /><span><strong className="block">Cabinet events</strong><span className="text-sm text-slate-500">Inspect locking and alert history.</span></span></Link>
            <Link to="/admin/users" className="flex min-h-24 items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 text-taptrack-navy shadow-sm transition hover:border-taptrack-gold hover:shadow-md"><Users className="text-taptrack-gold" size={24} /><span><strong className="block">User management</strong><span className="text-sm text-slate-500">Maintain authorized users.</span></span></Link>
          </section>
        </>
      )}
    </div>
  )
}
