import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Send, Clock3, Paperclip, Edit3, Trash2 } from 'lucide-react'
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

function formatDateSeparator(value) {
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  const diff = Math.floor((now - date) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}

function getInitials(name) {
  if (!name) return 'U'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null') || {}
  } catch {
    return {}
  }
}

export default function ActivityDiscussion({ activityId }) {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [attachment, setAttachment] = useState(null)
  const discussionRef = useRef(null)
  const composerRef = useRef(null)
  const user = useMemo(() => getCurrentUser(), [])

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/activity-discussions/', {
        params: { activity: activityId, ordering: 'created_at' },
      })
      const list = Array.isArray(response.data) ? response.data : response.data.results || []
      setMessages(list)
      setTimeout(() => {
        if (discussionRef.current) discussionRef.current.scrollTop = discussionRef.current.scrollHeight
      }, 100)
    } catch (err) {
      console.error('Failed to load discussion messages', err)
      setError('Unable to load discussion messages.')
    } finally {
      setLoading(false)
    }
  }, [activityId])

  useEffect(() => {
    if (!activityId) return
    const timeoutId = window.setTimeout(fetchMessages, 0)
    return () => window.clearTimeout(timeoutId)
  }, [activityId, fetchMessages])

  const postMessage = async (messageText, attachmentFile) => {
    if (!messageText.trim() && !attachmentFile) return
    setSending(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('activity', activityId)
      formData.append('message', messageText.trim())
      if (attachmentFile) {
        formData.append('attachment', attachmentFile)
      }
      await api.post('/activity-discussions/', formData)
      setNewMessage('')
      setAttachment(null)
      await fetchMessages()
    } catch (err) {
      console.error('Failed to send message', err)
      setError('Unable to send message.')
    } finally {
      setSending(false)
    }
  }

  const handleSend = async () => {
    if (editingId) {
      return saveEdit()
    }
    await postMessage(newMessage, attachment)
  }

  const startEdit = (message) => {
    setEditingId(message.id)
    setNewMessage(message.message)
  }

  const saveEdit = async () => {
    if (!editingId || !newMessage.trim()) return
    setSending(true)
    setError(null)
    try {
      await api.patch(`/activity-discussions/${editingId}/`, { message: newMessage.trim() })
      setEditingId(null)
      setNewMessage('')
      await fetchMessages()
    } catch (err) {
      console.error('Failed to update message', err)
      setError('Unable to save message edit.')
    } finally {
      setSending(false)
    }
  }

  const deleteMessage = async (messageId) => {
    if (!window.confirm('Delete this message?')) return
    setSending(true)
    setError(null)
    try {
      await api.delete(`/activity-discussions/${messageId}/`)
      await fetchMessages()
    } catch (err) {
      console.error('Failed to delete message', err)
      setError('Unable to delete message.')
    } finally {
      setSending(false)
    }
  }

  const groupedMessages = useMemo(() => {
    const groups = []
    let currentDate = null
    messages.forEach((message) => {
      const ts = new Date(message.created_at)
      const dayKey = ts.toDateString()
      if (dayKey !== currentDate) {
        groups.push({ type: 'date', key: `date-${dayKey}`, date: ts })
        currentDate = dayKey
      }
      groups.push({ type: 'message', key: `msg-${message.id}`, message })
    })
    return groups
  }, [messages])

  const canModify = (message) => {
    if (!user) return false
    return message.sender === user.id || ['instructor', 'admin'].includes(String(user.role).toLowerCase())
  }

  const messageRows = groupedMessages.map((item) => {
      if (item.type === 'date') {
        return (
          <div key={item.key} className="mx-auto mb-4 flex w-full justify-center">
            <span className="rounded-full bg-slate-100 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 shadow-sm">
              {formatDateSeparator(item.date)}
            </span>
          </div>
        )
      }

      const message = item.message
      const senderName = `${message.sender_name || ''} ${message.sender_last_name || ''}`.trim() || 'Unknown'
      const isCurrentUser = user && message.sender === user.id
      const isInstructor = String(message.sender_role).toLowerCase() === 'instructor'
      const bubbleClass = isCurrentUser
        ? 'bg-[#002B5B] text-white rounded-2xl rounded-br-sm'
        : isInstructor
        ? 'bg-[#f3f7fb] text-slate-900 rounded-2xl rounded-bl-sm border border-[#dbe5f0]'
        : 'bg-white text-slate-900 rounded-2xl rounded-bl-sm border border-[#dbe5f0]'
      const containerClass = isCurrentUser ? 'justify-end' : 'justify-start'
      const badgeClass = isInstructor ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'

      return (
        <div key={item.key} className={`flex w-full ${containerClass}`}>
          {!isCurrentUser && (
            <div className="mr-3 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
              {getInitials(senderName)}
            </div>
          )}
          <div className="w-fit max-w-[84%]">
            <div className={bubbleClass + ' p-3.5 shadow-sm sm:p-4'}>
              <div className={`mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold ${isCurrentUser ? 'text-white' : 'text-[#28415f]'}`}>
                <span>{senderName}</span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${isCurrentUser ? 'bg-white/15 text-white' : badgeClass}`}>
                  {isInstructor ? 'Instructor' : isCurrentUser ? 'You' : 'Student'}
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words text-sm leading-7">{message.message}</div>
              <div className={`mt-3 flex flex-wrap items-center gap-3 text-[11px] ${isCurrentUser ? 'text-white/70' : 'text-slate-400'}`}>
                <span className="inline-flex items-center gap-1">
                  <Clock3 size={12} /> {formatDateTime(message.created_at)}
                </span>
                {canModify(message) && (
                  <span className="inline-flex items-center gap-2">
                    <button type="button" onClick={() => startEdit(message)} className="inline-flex h-7 items-center gap-1 rounded-full bg-white/90 px-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100">
                      <Edit3 size={12} /> Edit
                    </button>
                    <button type="button" onClick={() => deleteMessage(message.id)} className="inline-flex h-7 items-center gap-1 rounded-full bg-white/90 px-2 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50">
                      <Trash2 size={12} /> Delete
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>
          {isCurrentUser && (
            <div className="ml-3 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {getInitials(senderName)}
            </div>
          )}
        </div>
      )
    })

  return (
    <section className="relative flex h-[min(620px,72vh)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[#dbe5f0] bg-white shadow-[0_12px_34px_rgba(25,55,89,0.08)]">
      <div className="flex-shrink-0 flex items-center justify-between gap-4 border-b border-[#e7edf4] px-5 py-4 sm:px-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Discussion</h3>
          <p className="text-sm text-slate-500">Shared activity chat for students and instructors.</p>
        </div>
        <button onClick={fetchMessages} className="rounded-xl border border-[#dbe5f0] bg-white px-3 py-2 text-sm font-semibold text-[#28415f] transition hover:bg-[#f7f9fc]">
          Refresh
        </button>
      </div>

      <div className="flex-1 min-h-0 px-4 sm:px-6">
        <div ref={discussionRef} className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-2 pb-3 pt-5">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center"><div><p className="font-semibold text-[#28415f]">No messages yet.</p><p className="mt-1 text-sm text-slate-500">Start a discussion about this activity.</p></div></div>
          ) : (
            <div className="space-y-4">{messageRows}</div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-[#e7edf4] bg-white px-4 py-4 sm:px-6">
        {error && <div className="mb-3 rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1"><label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="discussion-message">Message</label><textarea
            id="discussion-message"
            ref={composerRef}
            value={newMessage}
            onChange={(event) => setNewMessage(event.target.value)}
            rows={2}
            placeholder={editingId ? 'Edit message…' : 'Write a message…'}
            className="min-h-[84px] w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-900"
          /></div>
          <div className="flex flex-col gap-3 sm:w-auto sm:flex-row">
            <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-900">
              <Paperclip size={16} /> Attach
              <input
                type="file"
                className="hidden"
                onChange={(event) => setAttachment(event.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || (!newMessage.trim() && !attachment)}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#F5B700] px-5 py-3 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send size={16} /> {editingId ? 'Save' : 'Send'}
            </button>
          </div>
        </div>
        {attachment && (
          <div className="mt-3 flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span>{attachment.name} · {(attachment.size / 1024).toFixed(1)} KB</span>
            <button type="button" onClick={() => setAttachment(null)} className="min-h-10 rounded-lg px-3 font-semibold text-blue-900 hover:bg-blue-50">Remove</button>
          </div>
        )}
      </div>
    </section>
  )
}
