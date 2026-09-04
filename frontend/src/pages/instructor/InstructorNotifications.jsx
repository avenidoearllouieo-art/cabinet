import { useCallback, useEffect, useState } from 'react'
import { Bell, CheckCircle2, ArrowRight } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'

export default function InstructorNotifications() {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get('/notifications/')
      const data = Array.isArray(response.data) ? response.data : response.data.results || []
      setNotifications(data)
    } catch (err) {
      console.error('Failed to load notifications', err)
      setError('Unable to load notifications. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchNotifications, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchNotifications])

  const markAllRead = async () => {
    try {
      await api.post('/notifications/mark_all_read/')
      fetchNotifications()
    } catch (err) {
      console.error('Failed to mark all notifications read', err)
    }
  }

  const markRead = async (notificationId) => {
    try {
      await api.post(`/notifications/${notificationId}/mark_read/`)
      setNotifications((existing) =>
        existing.map((notification) =>
          notification.id === notificationId ? { ...notification, is_read: true } : notification
        )
      )
    } catch (err) {
      console.error('Failed to mark notification read', err)
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Instructor Notifications"
        description="Review the latest activity, deadline, and access log notifications."
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-slate-600">Stay up to date with the latest student activity and cabinet access events.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={markAllRead}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <CheckCircle2 size={16} />
            Mark all read
          </button>
        </div>
      </div>

      <div className="rounded-[20px] border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-slate-500">Loading notifications...</div>
        ) : error ? (
          <div className="py-16 text-center text-red-600">{error}</div>
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB]">
              <Bell size={20} />
            </div>
            <p className="text-base font-semibold text-slate-900">No notifications yet.</p>
            <p className="mt-2 text-sm text-slate-500">Notifications will appear here when students submit work or cabinet activity is logged.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`rounded-3xl border p-5 shadow-sm transition ${notification.is_read ? 'border-slate-200 bg-slate-50' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                        <ArrowRight size={14} />
                      </span>
                      <span className="font-semibold text-slate-900">{notification.title}</span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{notification.message}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {notification.is_read ? 'Read' : 'Unread'}
                    </div>
                    <button
                      onClick={() => markRead(notification.id)}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      Mark read
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <span>{new Date(notification.created_at).toLocaleString()}</span>
                  {notification.link ? (
                    <a href={notification.link} className="font-medium text-sky-600 hover:text-sky-800">
                      View details
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
