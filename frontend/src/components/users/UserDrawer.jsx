import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, CheckCircle2, CircleOff, Mail, Wifi, Clock3, Badge, ClipboardList, LayoutList, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../../services/api.js'
import UserCabinetAccessModal from './UserCabinetAccessModal.jsx'

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

const formatAction = (action) => {
  const value = String(action || '').toLowerCase()
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : '—'
}

const accessStatusLabel = (status) => String(status || '').toLowerCase() === 'success' ? 'Success' : 'Failed'

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
  const [counts, setCounts] = useState({ access_logs: 0, activities: 0, submissions: 0 })
  const [loading, setLoading] = useState(false)
  const [accessHistoryOpen, setAccessHistoryOpen] = useState(false)
  const [recordListType, setRecordListType] = useState('')
  const [recordListPage, setRecordListPage] = useState(1)
  const [recordListItems, setRecordListItems] = useState([])
  const [recordListHasNext, setRecordListHasNext] = useState(false)
  const [recordListHasPrevious, setRecordListHasPrevious] = useState(false)
  const [recordListLoading, setRecordListLoading] = useState(false)
  const [recordListError, setRecordListError] = useState('')

  const selectedUserId = user?.id || user?.pk || user?.user_id || user?.uuid

  const profileImageUrl = useMemo(() => getProfileImageUrl(user), [user])
  const displayName = useMemo(() => {
    if (!user) return ''
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim()
    return fullName || user.username || 'Untitled User'
  }, [user])

  const fetchDetails = useCallback(async (signal) => {
    setLoading(true)
    try {
      const uid = user?.id || user?.pk || user?.user_id || user?.uuid
      const response = await api.get(`/users/${uid}/profile-details/`, { signal })
      if (signal.aborted) return
      setLogs(response.data.access_logs || [])
      setSubmissions(response.data.submissions || [])
      setActivities(response.data.activities || [])
      setCounts(response.data.counts || { access_logs: 0, activities: 0, submissions: 0 })
    } catch (e) {
      if (!signal.aborted) console.error('Failed to load user details', e)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      setLogs([])
      setSubmissions([])
      setActivities([])
      setCounts({ access_logs: 0, activities: 0, submissions: 0 })
      fetchDetails(controller.signal)
    }, 0)
    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [user, fetchDetails])

  useEffect(() => {
    if (!recordListType || !selectedUserId) return undefined
    const controller = new AbortController()
    const loadRecords = async () => {
      setRecordListLoading(true)
      setRecordListError('')
      try {
        const response = await api.get(`/users/${selectedUserId}/${recordListType}/`, {
          params: { page: recordListPage, page_size: 20 },
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setRecordListItems(response.data.results || [])
        setRecordListHasNext(Boolean(response.data.next))
        setRecordListHasPrevious(Boolean(response.data.previous))
      } catch {
        if (!controller.signal.aborted) {
          setRecordListItems([])
          setRecordListError('Unable to load this user’s records.')
        }
      } finally {
        if (!controller.signal.aborted) setRecordListLoading(false)
      }
    }
    void loadRecords()
    return () => controller.abort()
  }, [recordListType, recordListPage, selectedUserId])

  const openRecordList = (type) => {
    setRecordListPage(1)
    setRecordListType(type)
  }

  const recordListTitle = recordListType === 'activities' ? 'Activities' : 'Submissions'

  if (!user) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex bg-slate-950/40">
      <div className="flex-1" onClick={onClose} />
      <aside className="relative ml-auto h-full w-[48vw] min-w-[480px] max-w-[760px] overflow-y-auto bg-white p-6 shadow-2xl max-md:w-full max-md:min-w-0">
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

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase text-slate-700">Basic Information</h3>
            <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard icon={<Badge size={16} />} label="System ID" value={getUserId(user)} />
            <InfoCard icon={<Badge size={16} />} label="Username" value={user.username || '—'} />
            <InfoCard icon={<Badge size={16} />} label="Full Name" value={displayName} />
            <InfoCard icon={<Mail size={16} />} label="Email" value={user.email || '—'} />
            <InfoCard icon={<Wifi size={16} />} label="NFC UID" value={user.nfc_uid ? <span className="break-all font-medium text-slate-900">{user.nfc_uid}</span> : 'Not assigned'} />
            <InfoCard icon={<Clock3 size={16} />} label="Last Login" value={formatDate(user.last_login)} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase text-slate-700">Role Details</h3>
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
          </section>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Recent activity summary</p>
                <p className="text-xs text-slate-500">Latest cabinet access, activities, and submissions</p>
              </div>
              {loading && <span className="text-xs text-slate-500">Updating…</span>}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <SummaryStat icon={<LayoutList size={18} />} label="Access Logs" value={counts.access_logs} />
              <SummaryStat icon={<BookOpen size={18} />} label="Activities" value={counts.activities} />
              <SummaryStat icon={<ClipboardList size={18} />} label="Submissions" value={counts.submissions} />
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Recent Cabinet Access</h3>
                <span className="text-right text-xs text-slate-500">Latest 5 entries for {displayName}</span>
                <button type="button" onClick={() => setAccessHistoryOpen(true)} className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">View All</button>
              </div>
              <div className="mt-4 text-sm text-slate-700">
                {loading ? (
                  <p className="text-slate-500">Loading access logs…</p>
                ) : logs.length ? (
                  <>
                    <div className="hidden overflow-hidden rounded-lg border border-slate-200 lg:block">
                      <table className="w-full table-fixed border-collapse text-left text-xs">
                        <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                          <tr className="border-b border-slate-200">
                            <th className="w-[10%] px-3 py-3">Action</th>
                            <th className="w-[10%] px-3 py-3">Status</th>
                            <th className="w-[13%] px-3 py-3">NFC UID</th>
                            <th className="w-[12%] px-3 py-3">Station</th>
                            <th className="w-[15%] px-3 py-3">Cabinet Name</th>
                            <th className="w-[22%] px-3 py-3">Reason</th>
                            <th className="w-[18%] px-3 py-3">Date/Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {logs.slice(0, 5).map((entry) => (
                            <tr key={entry.id} className="align-top">
                              <td className="break-words px-3 py-3 text-slate-800">{formatAction(entry.action)}</td>
                              <td className={`break-words px-3 py-3 font-semibold ${accessStatusLabel(entry.status) === 'Success' ? 'text-emerald-700' : 'text-red-700'}`}>{accessStatusLabel(entry.status)}</td>
                              <td className="break-all px-3 py-3 text-slate-700">{entry.nfc_uid || '—'}</td>
                              <td className="break-words px-3 py-3 text-slate-700">{entry.station || '—'}</td>
                              <td className="break-words px-3 py-3 text-slate-700">{entry.cabinet_name || '—'}</td>
                              <td className="break-words px-3 py-3 text-slate-700">{entry.reason || '—'}</td>
                              <td className="break-words px-3 py-3 text-slate-700">{formatDate(entry.access_time)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <ul className="space-y-3 lg:hidden">
                      {logs.slice(0, 5).map((entry) => (
                        <li key={entry.id} className="rounded-lg border border-slate-200 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-slate-900">{formatAction(entry.action)}</span>
                            <span className={`text-xs font-semibold ${accessStatusLabel(entry.status) === 'Success' ? 'text-emerald-700' : 'text-red-700'}`}>{accessStatusLabel(entry.status)}</span>
                          </div>
                          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                            <dt className="font-medium text-slate-500">NFC UID</dt><dd className="break-all text-slate-700">{entry.nfc_uid || '—'}</dd>
                            <dt className="font-medium text-slate-500">Station</dt><dd className="break-words text-slate-700">{entry.station || '—'}</dd>
                            <dt className="font-medium text-slate-500">Cabinet</dt><dd className="break-words text-slate-700">{entry.cabinet_name || '—'}</dd>
                            <dt className="font-medium text-slate-500">Reason</dt><dd className="break-words text-slate-700">{entry.reason || '—'}</dd>
                            <dt className="font-medium text-slate-500">Date/Time</dt><dd className="break-words text-slate-700">{formatDate(entry.access_time)}</dd>
                          </dl>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-slate-500">No recent access logs.</p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Recent Activities</h3>
                <button type="button" onClick={() => openRecordList('activities')} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">View All</button>
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
                <button type="button" onClick={() => openRecordList('submissions')} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">View All</button>
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
      <UserCabinetAccessModal
        isOpen={accessHistoryOpen}
        userId={selectedUserId}
        fullName={displayName}
        onClose={() => setAccessHistoryOpen(false)}
      />
      {recordListType && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setRecordListType('') }}>
          <section className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="profile-records-title">
            <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="profile-records-title" className="text-lg font-semibold text-slate-900">{recordListTitle} · {displayName}</h2>
                <p className="mt-1 text-sm text-slate-500">Records for this user only.</p>
              </div>
              <button type="button" onClick={() => setRecordListType('')} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label="Close records">
                <X size={18} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
              {recordListError && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{recordListError}</p>}
              {recordListLoading ? (
                <p className="py-10 text-center text-sm text-slate-500">Loading {recordListTitle.toLowerCase()}…</p>
              ) : recordListItems.length ? (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full table-fixed border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                      <tr>
                        <th className="border-b border-r border-slate-200 px-3 py-3">{recordListType === 'activities' ? 'Activity' : 'Activity'}</th>
                        {recordListType === 'activities' ? (
                          <>
                            <th className="border-b border-r border-slate-200 px-3 py-3">Section</th>
                            <th className="border-b border-slate-200 px-3 py-3">Due Date</th>
                          </>
                        ) : (
                          <>
                            <th className="border-b border-r border-slate-200 px-3 py-3">Submitted</th>
                            <th className="border-b border-slate-200 px-3 py-3">Status / Score</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recordListItems.map((item) => (
                        <tr key={item.id}>
                          <td className="break-words border-r border-slate-100 px-3 py-3 font-medium text-slate-800">{item.title || item.activity_title || item.activity || 'Untitled'}</td>
                          {recordListType === 'activities' ? (
                            <>
                              <td className="break-words border-r border-slate-100 px-3 py-3 text-slate-700">{item.section_name || item.section || '—'}</td>
                              <td className="break-words px-3 py-3 text-slate-700">{formatDate(item.due_date)}</td>
                            </>
                          ) : (
                            <>
                              <td className="break-words border-r border-slate-100 px-3 py-3 text-slate-700">{formatDate(item.submitted_at)}</td>
                              <td className="break-words px-3 py-3 text-slate-700">{item.status || item.submission_status || 'Submitted'}{item.score != null ? ` · ${item.score}` : ''}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : !recordListError ? (
                <p className="py-10 text-center text-sm text-slate-500">No {recordListTitle.toLowerCase()} found for this user.</p>
              ) : null}
            </div>
            <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
              <span className="text-xs text-slate-500">Page {recordListPage}</span>
              <div className="flex gap-2">
                <button type="button" disabled={!recordListHasPrevious || recordListLoading} onClick={() => setRecordListPage((page) => Math.max(1, page - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 disabled:opacity-50"><ChevronLeft size={16} /> Previous</button>
                <button type="button" disabled={!recordListHasNext || recordListLoading} onClick={() => setRecordListPage((page) => page + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 disabled:opacity-50">Next <ChevronRight size={16} /></button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>,
    document.body,
  )
}
