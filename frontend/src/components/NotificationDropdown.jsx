import { useCallback, useEffect, useState } from 'react'
import { Bell, ClipboardList, Send, GraduationCap, LockKeyhole, Settings, X, Inbox } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api.js'

const categoryStyles = {
  activity: { icon: ClipboardList, color: 'bg-blue-100 text-blue-700', label: 'Activities' },
  submission: { icon: Send, color: 'bg-violet-100 text-violet-700', label: 'Submissions' },
  grade: { icon: GraduationCap, color: 'bg-emerald-100 text-emerald-700', label: 'Grades' },
  access: { icon: LockKeyhole, color: 'bg-amber-100 text-amber-700', label: 'Cabinet Access' },
  system: { icon: Settings, color: 'bg-slate-100 text-slate-700', label: 'System' },
}

const getCategoryMeta = (notificationType) => {
  const normalized = String(notificationType || '').toLowerCase()
  if (normalized.includes('submission') || normalized === 'resubmission') return categoryStyles.submission
  if (normalized.includes('grade') || normalized.includes('feedback')) return categoryStyles.grade
  if (normalized.includes('access') || normalized.includes('cabinet')) return categoryStyles.access
  if (normalized.includes('system') || normalized.includes('password') || normalized.includes('profile')) return categoryStyles.system
  return categoryStyles.activity
}

const formatTimeAgo = (value) => {
  if (!value) return 'Just now'
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return 'Earlier'
}

export default function NotificationDropdown() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState(false)
  const [studentUnreadCount, setStudentUnreadCount] = useState(null)
  const navigate = useNavigate()
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}')

  useEffect(() => {
    if (currentUser.role !== 'student') return undefined
    const refreshUnreadCount = async () => {
      try {
        const response = await api.get('/notifications/unread_count/')
        setStudentUnreadCount(response.data.unread_count || 0)
      } catch (error) {
        console.error('Failed to fetch student unread notification count', error)
      }
    }
    refreshUnreadCount()
    const intervalId = window.setInterval(refreshUnreadCount, 30000)
    return () => window.clearInterval(intervalId)
  }, [currentUser.role])

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get('/notifications/')
      const data = Array.isArray(response.data) ? response.data : response.data.results || []
      setNotifications(data)
    } catch (error) {
      console.error('Failed to fetch notifications', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const timeoutId = window.setTimeout(fetchNotifications, 0)
    return () => window.clearTimeout(timeoutId)
  }, [open, fetchNotifications])

  useEffect(() => {
    if (!open) return
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const unreadCount = currentUser.role === 'student' && !open && studentUnreadCount !== null
    ? studentUnreadCount
    : notifications.filter((notification) => !notification.is_read).length

  const markRead = async (id) => {
    try {
      await api.post(`/notifications/${id}/mark_read/`)
      setNotifications((existing) => existing.map((notification) => (notification.id === id ? { ...notification, is_read: true } : notification)))
    } catch (error) {
      console.error('Failed to mark notification as read', error)
    }
  }

  const markAllRead = async () => {
    setBusyAction(true)
    try {
      await api.post('/notifications/mark_all_read/')
      setNotifications((existing) => existing.map((notification) => ({ ...notification, is_read: true })))
    } catch (error) {
      console.error('Failed to mark all notifications as read', error)
    } finally {
      setBusyAction(false)
    }
  }

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      await markRead(notification.id)
    }

    if (notification.link) {
      setOpen(false)
      navigate(notification.link)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-10 w-10 items-center justify-center rounded-[14px] border border-[#E5E7EB] bg-[#F8FAFC] text-[#475569] transition hover:bg-[#F1F5F9]"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[#2563EB] px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <button type="button" aria-label="Close notifications" className="absolute inset-0 bg-slate-950/40" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-[400px] max-w-[92vw] flex-col border-l border-[#E5E7EB] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#E5E7EB] px-5 py-5">
              <div>
                <h2 className="text-lg font-semibold text-[#111827]">Notifications</h2>
                <p className="mt-1 text-sm text-[#6B7280]">{unreadCount} unread</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={busyAction || unreadCount === 0}
                  className="rounded-full border border-[#E5E7EB] px-3 py-1.5 text-sm font-medium text-[#334155] transition hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Mark All as Read
                </button>
                <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-full p-2 text-[#64748B] transition hover:bg-[#F1F5F9] hover:text-[#0F172A]">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
              {loading ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-8 text-sm text-[#64748B]">
                  Loading notifications...
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-6 py-10 text-center text-[#64748B]">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#2563EB] shadow-sm">
                    <Inbox size={24} />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-[#111827]">No notifications yet.</p>
                    <p className="mt-1 text-sm">You will see updates here as they arrive.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {notifications.map((notification) => {
                    const meta = getCategoryMeta(notification.notification_type)
                    const Icon = meta.icon
                    return (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => handleNotificationClick(notification)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${notification.is_read ? 'border-[#E5E7EB] bg-white' : 'border-blue-100 bg-blue-50/70 shadow-sm'}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${meta.color}`}>
                            <Icon size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-[#111827]">{notification.title}</p>
                                <p className="mt-1 text-sm text-[#64748B]">{notification.message}</p>
                              </div>
                              {!notification.is_read && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#2563EB]" />}
                            </div>
                            <div className="mt-3 flex items-center justify-between text-xs text-[#94A3B8]">
                              <span>{meta.label}</span>
                              <span>{formatTimeAgo(notification.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
