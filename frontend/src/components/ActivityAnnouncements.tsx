import { useEffect, useMemo, useState } from 'react'
import { Send, Pin, PencilLine, Trash2, CheckCircle2 } from 'lucide-react'
import api from '../services/api.js'

function formatDateTime(value) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

function getCreatorName(announcement) {
  const first = announcement.created_by_name || ''
  const last = announcement.created_by_last_name || ''
  return [first, last].filter(Boolean).join(' ').trim() || 'Instructor'
}

function getUserRole() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    return user?.role || ''
  } catch {
    return ''
  }
}

export default function ActivityAnnouncements({ activityId }) {
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [isPinned, setIsPinned] = useState(false)
  const [isUpdate, setIsUpdate] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editMessage, setEditMessage] = useState('')
  const [editPinned, setEditPinned] = useState(false)
  const [editUpdate, setEditUpdate] = useState(false)

  const canEdit = useMemo(() => {
    const role = getUserRole().toLowerCase()
    return role === 'instructor' || role === 'admin'
  }, [])

  useEffect(() => {
    if (!activityId) return
    fetchAnnouncements()
  }, [activityId])

  const fetchAnnouncements = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/activity-announcements/', {
        params: { activity: activityId },
      })
      const list = Array.isArray(response.data) ? response.data : response.data.results || []
      setAnnouncements(list)
    } catch (err) {
      console.error('Failed to load announcements', err)
      setError('Unable to load announcements.')
    } finally {
      setLoading(false)
    }
  }

  const refreshAnnouncements = async () => {
    await fetchAnnouncements()
  }

  const createAnnouncement = async () => {
    if (!message.trim()) {
      setError('Announcement message cannot be empty.')
      return
    }
    setLoading(true)
    try {
      await api.post('/activity-announcements/', {
        activity: activityId,
        title: title.trim(),
        message: message.trim(),
        is_pinned: isPinned,
        is_update: isUpdate,
      })
      setTitle('')
      setMessage('')
      setIsPinned(false)
      setIsUpdate(false)
      await fetchAnnouncements()
    } catch (err) {
      console.error('Failed to create announcement', err)
      setError('Unable to post announcement.')
    } finally {
      setLoading(false)
    }
  }

  const startEdit = (announcement) => {
    setEditingId(announcement.id)
    setEditTitle(announcement.title || '')
    setEditMessage(announcement.message || '')
    setEditPinned(Boolean(announcement.is_pinned))
    setEditUpdate(Boolean(announcement.is_update))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
    setEditMessage('')
    setEditPinned(false)
    setEditUpdate(false)
  }

  const saveEdit = async () => {
    if (!editingId || !editMessage.trim()) {
      setError('Announcement message cannot be empty.')
      return
    }
    setLoading(true)
    try {
      await api.patch(`/activity-announcements/${editingId}/`, {
        title: editTitle.trim(),
        message: editMessage.trim(),
        is_pinned: editPinned,
        is_update: editUpdate,
      })
      cancelEdit()
      await fetchAnnouncements()
    } catch (err) {
      console.error('Failed to update announcement', err)
      setError('Unable to update announcement.')
    } finally {
      setLoading(false)
    }
  }

  const deleteAnnouncement = async (id) => {
    if (!window.confirm('Delete this announcement?')) return
    setLoading(true)
    try {
      await api.delete(`/activity-announcements/${id}/`)
      await fetchAnnouncements()
    } catch (err) {
      console.error('Failed to delete announcement', err)
      setError('Unable to delete announcement.')
    } finally {
      setLoading(false)
    }
  }

  const toggleFlag = async (announcement, field) => {
    setLoading(true)
    try {
      await api.patch(`/activity-announcements/${announcement.id}/`, {
        [field]: !announcement[field],
      })
      await fetchAnnouncements()
    } catch (err) {
      console.error(`Failed to toggle ${field}`, err)
      setError('Unable to update announcement status.')
    } finally {
      setLoading(false)
    }
  }

  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((left, right) => {
      if (left.is_pinned && !right.is_pinned) return -1
      if (!left.is_pinned && right.is_pinned) return 1
      return new Date(right.created_at) - new Date(left.created_at)
    })
  }, [announcements])

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.2)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-slate-700">
            <CheckCircle2 size={18} className="text-blue-600" />
            <h3 className="text-lg font-semibold">Activity Announcements</h3>
          </div>
          <p className="text-sm text-slate-500 mt-1">Instructor broadcasts for this activity are shown here.</p>
        </div>
        {canEdit && (
          <button onClick={refreshAnnouncements} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
            Refresh
          </button>
        )}
      </div>

      {canEdit && (
        <div className="mt-5 rounded-[18px] border border-slate-200 bg-slate-50 p-5">
          {error && <div className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional title"
              className="rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
            />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setIsPinned((current) => !current)} className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${isPinned ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700'}`}>
                <Pin size={14} /> {isPinned ? 'Pinned' : 'Pin'}
              </button>
              <button type="button" onClick={() => setIsUpdate((current) => !current)} className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${isUpdate ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700'}`}>
                {isUpdate ? 'Update' : 'Mark Update'}
              </button>
            </div>
          </div>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            placeholder="Write an announcement for students..."
            className="mt-4 w-full rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
          />
          <div className="mt-4 flex justify-end">
            <button onClick={createAnnouncement} disabled={loading} className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
              <Send size={15} /> Post Announcement
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {loading ? (
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading announcements…</div>
        ) : sortedAnnouncements.length ? (
          sortedAnnouncements.map((announcement) => {
            const isEditing = editingId === announcement.id
            return (
              <div key={announcement.id} className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-18px_rgba(15,23,42,0.25)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-900">{announcement.title || 'Announcement'}</p>
                      {announcement.is_pinned && <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">Pinned</span>}
                      {announcement.is_update && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Update</span>}
                    </div>
                    <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{announcement.message}</div>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => toggleFlag(announcement, 'is_pinned')} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                        <Pin size={14} /> {announcement.is_pinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button type="button" onClick={() => toggleFlag(announcement, 'is_update')} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                        <CheckCircle2 size={14} /> {announcement.is_update ? 'Clear Update' : 'Mark Update'}
                      </button>
                      <button type="button" onClick={() => startEdit(announcement)} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                        <PencilLine size={14} /> Edit
                      </button>
                      <button type="button" onClick={() => deleteAnnouncement(announcement.id)} className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100">
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  )}
                </div>
                {isEditing && (
                  <div className="mt-4 rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <input
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        placeholder="Edit title"
                        className="rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setEditPinned((current) => !current)} className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${editPinned ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700'}`}>
                          <Pin size={14} /> {editPinned ? 'Pinned' : 'Pin'}
                        </button>
                        <button type="button" onClick={() => setEditUpdate((current) => !current)} className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${editUpdate ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700'}`}>
                          {editUpdate ? 'Update' : 'Mark Update'}
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={editMessage}
                      onChange={(event) => setEditMessage(event.target.value)}
                      rows={4}
                      className="mt-4 w-full rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                    />
                    <div className="mt-4 flex flex-wrap gap-2 justify-end">
                      <button type="button" onClick={saveEdit} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">Save</button>
                      <button type="button" onClick={cancelEdit} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
                  <div>By {getCreatorName(announcement)}</div>
                  <div>{formatDateTime(announcement.created_at)}</div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">No announcements have been posted yet.</div>
        )}
      </div>
    </section>
  )
}
