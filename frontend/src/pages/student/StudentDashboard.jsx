import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Clock, LogIn, Send, AlertCircle } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import CabinetStationStatus from '../../components/CabinetStationStatus'

export default function StudentDashboard() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalActivities: 0,
    totalSubmissions: 0,
    pendingActivities: 0,
    submittedActivities: 0,
    cabinetAccessToday: 0,
  })
  const [user, setUser] = useState(null)
  const [upcomingActivities, setUpcomingActivities] = useState([])
  const [recentSubmissions, setRecentSubmissions] = useState([])
  const [recentAccessLogs, setRecentAccessLogs] = useState([])
  const [renderedAt] = useState(() => Date.now())

  const fetchProfile = useCallback(async () => {
    try {
      const res = await api.get('/users/profile/')
      setUser(res.data)
    } catch {
      setUser(null)
    }
  }, [])

  const fetchDashboard = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchDashboard()
      fetchProfile()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchDashboard, fetchProfile])

  useEffect(() => {
    const handler = () => { fetchDashboard() }
    window.addEventListener('studentSubmissionSaved', handler)
    return () => window.removeEventListener('studentSubmissionSaved', handler)
  }, [fetchDashboard])

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

  const timeRemaining = (due) => {
    if (!due) return '—'
    const diff = new Date(due).getTime() - renderedAt
    const abs = Math.abs(diff)
    const minutes = Math.round(abs / 60000)
    if (diff < 0) {
      if (minutes < 60) return `${minutes}m overdue`
      if (minutes < 1440) return `${Math.round(minutes / 60)}h overdue`
      return `${Math.round(minutes / 1440)}d overdue`
    }
    if (minutes < 60) return `${minutes}m left`
    if (minutes < 1440) return `${Math.round(minutes / 60)}h left`
    return `${Math.round(minutes / 1440)}d left`
  }

  const dueBadge = (dueDate) => {
    if (!dueDate) return null
    const diffHours = (new Date(dueDate).getTime() - renderedAt) / 3600000
    if (diffHours < 0) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"><AlertCircle size={12} /> Overdue</span>
    if (diffHours <= 48) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"><Clock size={12} /> Due Soon</span>
    return null
  }

  const sortedUpcomingActivities = [...upcomingActivities].sort(
    (a, b) => new Date(a.due_date || 0) - new Date(b.due_date || 0),
  )

  return (
    <div className="space-y-5">
      <PageHeader
        compact
        title="Student Dashboard"
        description={user
          ? `Welcome back, ${user.first_name || user.username || 'student'}. Here's a summary of your activities and cabinet access.`
          : 'Welcome back. Here is a summary of your activities and cabinet access.'}
      />
      <CabinetStationStatus detailLevel="student" />

      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-12 text-center text-[#6B7280] shadow-sm">
          Loading dashboard...
        </div>
      ) : (
        <>
              <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
                <StatCard
                  icon={<BookOpen size={18} />}
                  label="Assigned Activities"
                  value={stats.totalActivities}
                  subtitle="Open and upcoming tasks"
                  mobileSubtitle="Open tasks"
                  bgColor="bg-blue-50"
                  textColor="text-blue-600"
                  borderColor="border-blue-200"
                />
                <StatCard
                  icon={<Send size={18} />}
                  label="Submitted"
                  value={stats.submittedActivities}
                  subtitle="Activities you submitted"
                  mobileSubtitle="Submitted"
                  bgColor="bg-emerald-50"
                  textColor="text-emerald-700"
                  borderColor="border-emerald-200"
                />
                <StatCard
                  icon={<Clock size={18} />}
                  label="Pending"
                  value={stats.pendingActivities}
                  subtitle="Still to complete"
                  mobileSubtitle="To do"
                  bgColor="bg-amber-50"
                  textColor="text-amber-700"
                  borderColor="border-amber-200"
                />
                <StatCard
                  icon={<LogIn size={18} />}
                  label="Cabinet Access Today"
                  value={stats.cabinetAccessToday}
                  subtitle="Today’s access attempts"
                  mobileSubtitle="Today"
                  bgColor="bg-violet-50"
                  textColor="text-violet-700"
                  borderColor="border-violet-200"
                />
              </div>

          <div className="grid gap-4 xl:grid-cols-3 xl:gap-6">
            <div className="min-w-0 rounded-[12px] border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-6 xl:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4 sm:gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Upcoming Activities</h2>
                  <p className="mt-1 text-sm text-slate-500">Deadlines and tasks you need to complete.</p>
                </div>
                <div className="text-sm text-slate-500">{upcomingActivities.length} items • Sorted by due date</div>
              </div>

              {upcomingActivities.length === 0 ? (
                <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-8 text-center sm:p-16">
                  <div className="mx-auto max-w-md">
                    <p className="font-semibold text-[#28415f]">No upcoming activities</p>
                    <p className="mt-2 text-sm text-[#64748b]">You&apos;re all caught up. New activities will appear here when assigned.</p>
                  </div>
                </div>
              ) : (
                <>
                <div className="space-y-2 min-[600px]:hidden" role="list" aria-label="Upcoming activities">
                  {sortedUpcomingActivities.map((activity) => (
                    <article key={activity.id} role="listitem" className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <h3 className="min-w-0 break-words text-sm font-semibold text-slate-900">{activity.title}</h3>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{activity.status || 'Active'}</span>
                      </div>
                      <p className="mt-1 break-words text-xs text-slate-500">{activity.section_name || activity.subject || '—'}</p>
                      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                        <div className="min-w-0">
                          <dt className="text-slate-500">Due date</dt>
                          <dd className="mt-1 break-words font-medium text-slate-700">{formatDate(activity.due_date)} {dueBadge(activity.due_date)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-slate-500">Remaining</dt>
                          <dd className="mt-1 break-words font-medium text-slate-700">{timeRemaining(activity.due_date)}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
                <div className="hidden w-full overflow-x-auto min-[600px]:block" role="region" aria-label="Upcoming activities table" tabIndex={0}>
                  <table className="w-full min-w-[640px] table-fixed border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="w-[28%] border-r border-slate-200 px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-slate-600 sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Activity</th>
                        <th className="w-[20%] border-r border-slate-200 px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-slate-600 sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Subject / Section</th>
                        <th className="w-[22%] border-r border-slate-200 px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-slate-600 sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Due Date</th>
                        <th className="w-[14%] border-r border-slate-200 px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-slate-600 sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Status</th>
                        <th className="w-[16%] px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-slate-600 sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedUpcomingActivities.map((activity) => (
                        <tr key={activity.id} className="border-b border-slate-100 even:bg-slate-50 hover:bg-slate-100">
                          <td className="break-words border-r border-slate-100 px-1.5 py-2 text-slate-900 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{activity.title}</td>
                          <td className="break-words border-r border-slate-100 px-1.5 py-2 text-slate-600 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{activity.section_name || activity.subject || '—'}</td>
                          <td className="break-words border-r border-slate-100 px-1.5 py-2 text-slate-600 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{formatDate(activity.due_date)} {dueBadge(activity.due_date)}</td>
                          <td className="break-words border-r border-slate-100 px-1.5 py-2 text-slate-600 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{activity.status || 'Active'}</td>
                          <td className="break-words px-1.5 py-2 text-slate-600 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{timeRemaining(activity.due_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </div>

            <div className="space-y-4 sm:space-y-6">
              <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-6">
                <h3 className="text-sm font-semibold text-slate-900">Cabinet Status</h3>
                <p className="mt-1 text-xs text-slate-500">Quick cabinet info</p>
                <div className="mt-4 space-y-3 text-sm text-slate-700">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-500">Last Access</div>
                    <div className="font-medium">{recentAccessLogs[0] ? formatDate(recentAccessLogs[0].access_time) : '—'}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-500">Today’s Access</div>
                    <div className="font-medium">{stats.cabinetAccessToday}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-500">Availability</div>
                    <div className="font-medium">
                      {(() => {
                        const last = recentAccessLogs[0]
                        if (!last) return 'Hardware not connected'
                        const s = String(last.status || '').toLowerCase()
                        if (s.includes('unlock') || s.includes('open')) return 'Unlocked'
                        if (s.includes('lock') || s.includes('locked')) return 'Locked'
                        return 'Hardware not connected'
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-6">
                <h3 className="text-sm font-semibold text-slate-900">Progress Overview</h3>
                <p className="mt-1 text-xs text-slate-500">Your activity and submission progress</p>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between text-sm text-slate-700">
                    <div>Completed</div>
                    <div className="font-medium">{stats.submittedActivities}</div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-700">
                    <div>Pending</div>
                    <div className="font-medium">{stats.pendingActivities}</div>
                  </div>
                  <div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${stats.totalActivities ? Math.round((stats.submittedActivities / stats.totalActivities) * 100) : 0}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Submission progress: {stats.totalActivities ? Math.round((stats.submittedActivities / stats.totalActivities) * 100) : 0}%</div>
                  </div>
                </div>
              </div>

              <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-3 shadow-sm sm:p-4">
                <h4 className="text-sm font-semibold text-slate-900">Upcoming Deadlines</h4>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  {upcomingActivities.length === 0 ? (
                    <div className="text-sm text-slate-500">No deadlines coming up.</div>
                  ) : (
                    upcomingActivities
                      .slice()
                      .sort((a, b) => new Date(a.due_date || 0) - new Date(b.due_date || 0))
                      .slice(0, 5)
                      .map((a) => (
                        <div key={a.id} className="flex items-center justify-between">
                          <div className="truncate pr-3">{a.title}</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">{timeRemaining(a.due_date)} {dueBadge(a.due_date)}</div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4 sm:gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Recent Submissions</h2>
                <p className="mt-1 text-sm text-slate-500">Review the status of your latest work.</p>
              </div>
              <div className="text-sm text-slate-500">{recentSubmissions.length} submissions</div>
            </div>

            <DataTable
              columns={[
                { key: 'activity_title', label: 'Activity' },
                { key: 'submitted_at', label: 'Submitted Date', render: (value) => formatDate(value) },
                { key: 'score', label: 'Score', render: (value) => (value !== null && value !== undefined ? value : 'Pending') },
                { key: 'status', label: 'Submission Status' },
                { key: 'feedback', label: 'Feedback', render: (_v, row) => (row.feedback ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Available</span> : <span className="text-xs text-slate-400">—</span>) },
              ]}
              data={recentSubmissions}
              loading={loading}
              showActions={false}
            />
          </div>
        </>
      )}
    </div>
  )
}
