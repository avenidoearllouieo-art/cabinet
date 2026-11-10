import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, CheckCircle2, CircleOff, Mail, Wifi, Clock3, Badge, ClipboardList, LayoutList, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../../services/api.js'
import Modal from '../Modal.jsx'
import UserCabinetAccessModal from './UserCabinetAccessModal.jsx'

const getUserId = (user) => {
  if (!user) return '—'
  return user.id ?? user.pk ?? user.user_id ?? user.uuid ?? '—'
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
  if (normalized === 'administrator' || normalized === 'admin') return 'bg-[#eef4fa] text-[#002B5B]'
  if (normalized === 'instructor') return 'bg-[#DBEAFE] text-[#1D4ED8]'
  if (normalized === 'student') return 'bg-[#DCFCE7] text-[#15803D]'
  return 'bg-[#E5E7EB] text-[#374151]'
}

const getProfileImageUrl = (user) => {
  return user?.profile_image_url || user?.profile_image || user?.avatar_url || user?.avatar || null
}

const InfoCard = ({ icon, label, value }) => (
  <div className="min-w-0 rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-3">
    <div className="flex items-center gap-2 text-slate-500">
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </div>
    <p className="mt-2 break-words text-sm font-semibold text-slate-900">{value || '—'}</p>
  </div>
)

const SummaryStat = ({ icon, label, value }) => (
  <div className="min-w-0 rounded-lg border border-[#dbe5f0] bg-white p-2.5 text-xs text-slate-700 shadow-sm sm:p-3">
    <div className="flex flex-col items-start gap-1 text-slate-500 sm:flex-row sm:items-center sm:gap-2">
      {icon}
      <span className="break-words">{label}</span>
    </div>
    <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
  </div>
)

export default function UserDrawer({ user, onClose, onAction }) {
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
  const closeButtonRef = useRef(null)
  const previousFocusRef = useRef(null)
  const drawerCloseRef = useRef(onClose)
  const nestedOverlayStateRef = useRef({ recordListType, accessHistoryOpen })

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
      const response = await api.get(`/users/${selectedUserId}/profile-details/`, { signal })
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
  }, [selectedUserId])

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

  useEffect(() => {
    drawerCloseRef.current = onClose
    nestedOverlayStateRef.current = { recordListType, accessHistoryOpen }
  }, [onClose, recordListType, accessHistoryOpen])

  useEffect(() => {
    if (!selectedUserId) return undefined
    previousFocusRef.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        const drawer = closeButtonRef.current?.closest('[role="dialog"]')
        const topDialog = [...document.querySelectorAll('[role="dialog"]')].at(-1)
        if (topDialog !== drawer) {
          if (nestedOverlayStateRef.current.recordListType) setRecordListType('')
          else if (nestedOverlayStateRef.current.accessHistoryOpen) setAccessHistoryOpen(false)
          return
        }
        drawerCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const drawer = closeButtonRef.current?.closest('[role="dialog"]')
      const focusable = [...(drawer?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') || [])]
        .filter((element) => element.getClientRects().length)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
    }
  }, [selectedUserId])

  if (!user) return null

  return createPortal(
    <div className="fixed inset-0 z-[var(--tt-layer-drawer)] flex bg-slate-950/45" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <aside className="relative ml-auto flex h-full w-full max-w-[760px] flex-col overflow-hidden bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="user-profile-title">
        <header className="z-10 flex shrink-0 items-center gap-3 border-b border-[#dbe5f0] border-l-4 border-l-[#ffc107] bg-[#eef4fa] px-3 py-3 sm:px-5">
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="order-2 ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107] sm:order-last"
          aria-label="Close profile drawer"
        >
          <X size={18} />
        </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100">
              {profileImageUrl ? (
                <img src={profileImageUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-200 text-lg font-semibold text-slate-600">
                  {(user.first_name?.[0] || user.last_name?.[0] || user.username?.[0] || 'U').toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase text-slate-500">User Profile</p>
              <h2 id="user-profile-title" className="break-words text-base font-semibold leading-5 text-slate-900 sm:text-lg">{displayName}</h2>
              <p className="break-all text-xs text-slate-600">@{user.username || '—'}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleColors(user.role)}`}>
                  {roleLabel(user.role)}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${user.is_active ? 'bg-[#ECFDF3] text-[#15803D]' : 'bg-[#FEE2E2] text-[#B91C1C]'}`}>
                  {user.is_active ? <CheckCircle2 size={11} /> : <CircleOff size={11} />}{user.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        <div className="flex flex-col gap-4">
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
            <button type="button" onClick={() => onAction?.('assign_nfc', user)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-[#002B5B] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107]">
              <Wifi size={16} />{user.nfc_uid ? 'Change NFC UID' : 'Assign NFC UID'}
            </button>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase text-slate-700">Role Details</h3>
          {String(user.role || '').toLowerCase() === 'student' && (
            <div className="rounded-lg border border-[#dbe5f0] bg-[#eef4fa] p-3">
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
                {(user.section_program || user.section_year_level || user.section_academic_year) && (
                  <>
                    {user.section_program && <div><span className="font-semibold text-slate-900">Program:</span> {user.section_program}</div>}
                    {user.section_year_level && <div><span className="font-semibold text-slate-900">Year level:</span> {user.section_year_level}</div>}
                    {user.section_academic_year && <div><span className="font-semibold text-slate-900">Academic year:</span> {user.section_academic_year}</div>}
                  </>
                )}
              </div>
            </div>
          )}

          {String(user.role || '').toLowerCase() === 'instructor' && (
            <div className="rounded-lg border border-[#dbe5f0] bg-[#eef4fa] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Instructor Details</p>
                  <p className="text-xs text-slate-500">Assigned teaching sections</p>
                </div>
              </div>
              <div className="mt-4 text-sm text-slate-700">
                <div>
                  <span className="font-semibold text-slate-900">Instructor ID:</span> {user.instructor_id || '—'}
                </div>
                {user.assigned_sections && user.assigned_sections.length ? (
                  <ul className="space-y-2">
                    {user.assigned_sections.map((section) => (
                      <li key={section.id || section.section || section.section_name} className="rounded-lg bg-white p-3 text-slate-700 shadow-sm">
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

          {['admin', 'administrator'].includes(String(user.role || '').toLowerCase()) && (
            <div className="rounded-lg border border-[#dbe5f0] bg-[#eef4fa] p-3">
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

          <div className="rounded-lg border border-[#dbe5f0] bg-[#eef4fa] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Recent activity summary</p>
                <p className="text-xs text-slate-500">Latest cabinet access, activities, and submissions</p>
              </div>
              {loading && <span className="text-xs text-slate-500">Updating…</span>}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
              <SummaryStat icon={<LayoutList size={18} />} label="Access Logs" value={counts.access_logs} />
              <SummaryStat icon={<BookOpen size={18} />} label="Activities" value={counts.activities} />
              <SummaryStat icon={<ClipboardList size={18} />} label="Submissions" value={counts.submissions} />
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Recent Cabinet Access</h3>
                <span className="text-xs text-slate-500 sm:ml-auto sm:text-right">Latest 5 entries for {displayName}</span>
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
                    <div key={activity.id || activity.title} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
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
                    <div key={submission.id || `${submission.activity}_${submission.submitted_at}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
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
        </div>
      </aside>
      <UserCabinetAccessModal
        isOpen={accessHistoryOpen}
        userId={selectedUserId}
        fullName={displayName}
        onClose={() => setAccessHistoryOpen(false)}
      />
      <Modal
        isOpen={Boolean(recordListType)}
        onClose={() => setRecordListType('')}
        title={`${recordListTitle} · ${displayName}`}
        description="Records for this user only."
        contentSized={!recordListLoading && !recordListItems.length && !recordListError}
        maxWidth="min(92vw, 64rem)"
        footer={(recordListItems.length || recordListHasNext || recordListHasPrevious) ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">Page {recordListPage}</span>
            <div className="flex gap-2">
              <button type="button" disabled={!recordListHasPrevious || recordListLoading} onClick={() => setRecordListPage((page) => Math.max(1, page - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 disabled:opacity-50"><ChevronLeft size={16} /> Previous</button>
              <button type="button" disabled={!recordListHasNext || recordListLoading} onClick={() => setRecordListPage((page) => page + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 disabled:opacity-50">Next <ChevronRight size={16} /></button>
            </div>
          </div>
        ) : null}
      >
        {recordListError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{recordListError}</p>}
        {recordListLoading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading {recordListTitle.toLowerCase()}…</p>
        ) : recordListItems.length ? (
          <div className="overflow-x-auto rounded-lg border border-[#dbe5f0]">
            <table className="min-w-[640px] w-full table-fixed border-collapse text-left text-sm">
              <thead className="bg-[#eef4fa] text-xs font-semibold uppercase text-[#526780]">
                <tr>
                  <th className="border-b border-r border-[#dbe5f0] px-3 py-3">Activity</th>
                  {recordListType === 'activities' ? (
                    <>
                      <th className="border-b border-r border-[#dbe5f0] px-3 py-3">Section</th>
                      <th className="border-b border-[#dbe5f0] px-3 py-3">Due Date</th>
                    </>
                  ) : (
                    <>
                      <th className="border-b border-r border-[#dbe5f0] px-3 py-3">Submitted</th>
                      <th className="border-b border-[#dbe5f0] px-3 py-3">Status / Score</th>
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
          <div className="mx-auto flex max-w-lg items-center gap-4 rounded-xl border border-dashed border-[#cbd8e6] bg-[#eef4fa] px-5 py-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-[#082b53]"><ClipboardList size={20} /></span>
            <div>
              <p className="font-semibold text-[#102a4c]">No {recordListTitle.toLowerCase()} found</p>
              <p className="mt-1 text-sm text-[#64748b]">There are no records for this user yet.</p>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>,
    document.body,
  )
}
