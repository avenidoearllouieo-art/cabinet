import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import { X, CheckCircle2, CircleOff, Mail, Wifi, Clock3, User, Badge, ClipboardList, LayoutList, BookOpen } from 'lucide-react'
import api from '../../services/api.js'

const getUserId = (user) => {
  if (!user) return '—'
  const role = (user.role || '').toLowerCase()
  if (role === 'student') return user.student_id || user.id || '—'
  if (role === 'instructor') return user.instructor_id || user.id || '—'
  if (role === 'admin' || role === 'administrator') return user.id || '—'
  return user.id || '—'
}

const formatDate = (dateValue) => {
  if (!dateValue) return '—'
  const date = new Date(dateValue)
  return Number.isNaN(date.getTime()) ? String(dateValue) : date.toLocaleString()
}

const roleLabel = (role) => {
  const normalized = (role || '').toLowerCase()
  if (normalized === 'administrator' || normalized === 'admin') return 'Administrator'
  if (normalized === 'instructor') return 'Instructor'
  if (normalized === 'student') return 'Student'
  return role || 'Unknown'
}

const roleColors = (role) => {
  const normalized = (role || '').toLowerCase()
  if (normalized === 'administrator' || normalized === 'admin') return 'bg-[#F3E8FF] text-[#6D28D9]'
  if (normalized === 'instructor') return 'bg-[#DBEAFE] text-[#1D4ED8]'
  if (normalized === 'student') return 'bg-[#DCFCE7] text-[#15803D]'
  return 'bg-[#E5E7EB] text-[#374151]'
}

const getProfileImageUrl = (user) => {
  return user?.profile_image_url || user?.profile_image || user?.avatar_url || user?.avatar || null
}

const InfoCard = ({ icon, label, value }) => (
  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex items-center gap-3 text-slate-500">
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </div>
    <p className="mt-3 text-base font-semibold text-slate-900 break-words">{value || '—'}</p>
  </div>
)

const SummaryStat = ({ icon, label, value }) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
    <div className="flex items-center gap-2 text-slate-500">
      {icon}
      <span>{label}</span>
    </div>
    <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
  </div>
)

export default function UserDrawer({ user, onClose }) {
  const [logs, setLogs] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(false)

  const profileImageUrl = useMemo(() => getProfileImageUrl(user), [user])
  const displayName = useMemo(() => {
    if (!user) return ''
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim()
    return fullName || user.username || 'Untitled User'
  }, [user])

  useEffect(() => {
    if (!user) return
    setLogs([])
    setSubmissions([])
    setActivities([])
    fetchDetails()
  }, [user])

  const fetchDetails = async () => {
    setLoading(true)
    try {
      const uid = user?.id || user?.pk || user?.user_id || user?.uuid
      const [logsRes, subsRes, actsRes] = await Promise.all([
        api.get(`/access-logs/?user=${uid}`),
        api.get(`/submissions/?student=${uid}`),
        api.get(`/activities/?created_by=${uid}`),
      ])
      setLogs(Array.isArray(logsRes.data) ? logsRes.data : logsRes.data.results || [])
      setSubmissions(Array.isArray(subsRes.data) ? subsRes.data : subsRes.data.results || [])
      setActivities(Array.isArray(actsRes.data) ? actsRes.data : actsRes.data.results || [])
    } catch (e) {
      console.error('Failed to load user details', e)
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex bg-slate-950/40">
      <div className="flex-1" onClick={onClose} />
      <aside className="relative w-full max-w-[580px] overflow-y-auto bg-white p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-100"
          aria-label="Close profile drawer"
        >
          <X size={18} />
        </button>

        <div className="flex flex-col gap-4 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-[28px] bg-slate-100">
              {profileImageUrl ? (
                <img src={profileImageUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-200 text-3xl font-semibold text-slate-600">
                  {(user.first_name?.[0] || user.last_name?.[0] || user.username?.[0] || 'U').toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">User Profile</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">{displayName}</h2>
              <p className="mt-1 text-sm text-slate-600">{user.username || '—'}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${roleColors(user.role)}`}>
                  {roleLabel(user.role)}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${user.is_active ? 'bg-[#ECFDF3] text-[#15803D]' : 'bg-[#FEE2E2] text-[#B91C1C]'}`}>
                  {user.is_active ? <CheckCircle2 size={12} /> : <CircleOff size={12} />}
                  {user.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoCard icon={<Badge size={16} />} label="System ID" value={getUserId(user)} />
            <InfoCard icon={<Mail size={16} />} label="Email" value={user.email || '—'} />
            <InfoCard icon={<Wifi size={16} />} label="NFC UID" value={user.nfc_uid ? <span className="break-all font-medium text-slate-900">{user.nfc_uid}</span> : 'Not assigned'} />
            <InfoCard icon={<Clock3 size={16} />} label="Last Login" value={formatDate(user.last_login)} />
          </div>

          {user.role === 'student' && (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Student Details</p>
                  <p className="text-xs text-slate-500">Academic section and IDs</p>
                </div>
              </div>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                <div>
                  <span className="font-semibold text-slate-900">Student ID:</span> {user.student_id || '—'}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Section:</span> {user.section_name || user.section || '—'}
                </div>
              </div>
            </div>
          )}

          {user.role === 'instructor' && (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Instructor Details</p>
                  <p className="text-xs text-slate-500">Assigned teaching sections</p>
                </div>
              </div>
              <div className="mt-4 text-sm text-slate-700">
                {user.assigned_sections && user.assigned_sections.length ? (
                  <ul className="space-y-2">
                    {user.assigned_sections.map((section) => (
                      <li key={section.id || section.section || section.section_name} className="rounded-2xl bg-white p-3 text-slate-700 shadow-sm">
                        {section.section_name || section.section || 'Unnamed section'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No sections assigned.</p>
                )}
              </div>
            </div>
          )}

          {user.role === 'admin' && (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Administrator Details</p>
                  <p className="text-xs text-slate-500">System-level permissions and access</p>
                </div>
              </div>
              <div className="mt-4 text-sm text-slate-700">
                <div>
                  <span className="font-semibold text-slate-900">Admin ID:</span> {user.id || '—'}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Staff status:</span> {user.is_staff ? 'Yes' : 'No'}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Recent activity summary</p>
                <p className="text-xs text-slate-500">Latest cabinet access, activities, and submissions</p>
              </div>
              {loading && <span className="text-xs text-slate-500">Updating…</span>}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <SummaryStat icon={<LayoutList size={18} />} label="Access Logs" value={logs.length} />
              <SummaryStat icon={<BookOpen size={18} />} label="Activities" value={activities.length} />
              <SummaryStat icon={<ClipboardList size={18} />} label="Submissions" value={submissions.length} />
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Recent Cabinet Access</h3>
                <span className="text-xs text-slate-500">Last 5 entries</span>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                {loading ? (
                  <p className="text-slate-500">Loading access logs…</p>
                ) : logs.length ? (
                  logs.slice(0, 5).map((entry) => (
                    <div key={entry.id || `${entry.user}_${entry.access_time}`} className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-slate-900">{entry.status || 'Unknown'}</span>
                        <span className="text-xs text-slate-500">{formatDate(entry.access_time)}</span>
                      </div>
                      {entry.device_id && <p className="mt-2 text-sm text-slate-600">Device: {entry.device_id}</p>}
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500">No recent access logs.</p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Recent Activities</h3>
                <span className="text-xs text-slate-500">Last 5 entries</span>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                {loading ? (
                  <p className="text-slate-500">Loading activities…</p>
                ) : activities.length ? (
                  activities.slice(0, 5).map((activity) => (
                    <div key={activity.id || activity.title} className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="font-medium text-slate-900">{activity.title || activity.name || 'Untitled activity'}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <Clock3 size={14} />
                        <span>{activity.due_date ? new Date(activity.due_date).toLocaleDateString() : 'No due date'}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500">No recent activities.</p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Recent Submissions</h3>
                <span className="text-xs text-slate-500">Last 5 entries</span>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                {loading ? (
                  <p className="text-slate-500">Loading submissions…</p>
                ) : submissions.length ? (
                  submissions.slice(0, 5).map((submission) => (
                    <div key={submission.id || `${submission.activity}_${submission.submitted_at}`} className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="font-medium text-slate-900">{submission.activity_title || submission.activity || 'Untitled submission'}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(submission.submitted_at)}</div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500">No recent submissions.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
