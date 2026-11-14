import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Send, Paperclip, Edit3, Trash2 } from 'lucide-react'
import api from '../services/api.js'
import AcademicFileAttachments from './files/AcademicFileAttachments.jsx'

function formatDateTime(value) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Manila',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

function formatDateSeparator(value) {
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  const dateKey = (value) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
  const todayKey = dateKey(now)
  if (dateKey(date) === todayKey) return 'Today'
  const yesterday = new Date(now.getTime() - 86400000)
  if (dateKey(date) === dateKey(yesterday)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(date)
}

const sortMessages = (items) => [...items].sort((left, right) => {
  const timeDifference = new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  return timeDifference || Number(left.id) - Number(right.id)
})

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
  const sendingGuardRef = useRef(false)
  const user = useMemo(() => getCurrentUser(), [])

  const mergeMessage = (message) => {
    setMessages((current) => sortMessages([...current.filter((item) => String(item.id) !== String(message.id)), message]))
  }

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/activity-discussions/', {
        params: { activity: activityId, ordering: 'created_at' },
      })
      const list = Array.isArray(response.data) ? response.data : response.data.results || []
      setMessages(sortMessages(list))
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
    if (sendingGuardRef.current || loading || (!messageText.trim() && !attachmentFile)) return
    sendingGuardRef.current = true
    setSending(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('activity', activityId)
      formData.append('message', messageText.trim())
      if (attachmentFile) {
        formData.append('attachment', attachmentFile)
      }
      const response = await api.post('/activity-discussions/', formData)
      if (response.data?.id) mergeMessage(response.data)
      else await fetchMessages()
      setNewMessage('')
      setAttachment(null)
    } catch (err) {
      console.error('Failed to send message', err)
      setError('Unable to send message.')
    } finally {
      sendingGuardRef.current = false
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
    if (sendingGuardRef.current || !editingId || !newMessage.trim()) return
    sendingGuardRef.current = true
    setSending(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('message', newMessage.trim())
      if (attachment) formData.append('attachment', attachment)
      const response = await api.patch(`/activity-discussions/${editingId}/`, formData)
      const updatedMessage = response.data?.id
        ? response.data
        : { ...messages.find((message) => String(message.id) === String(editingId)), message: newMessage.trim() }
      if (updatedMessage?.id) mergeMessage(updatedMessage)
      setEditingId(null)
      setNewMessage('')
      setAttachment(null)
    } catch (err) {
      console.error('Failed to update message', err)
      setError('Unable to save message edit.')
    } finally {
      sendingGuardRef.current = false
      setSending(false)
    }
  }

  const deleteMessage = async (messageId) => {
    if (!window.confirm('Delete this message?')) return
    if (sendingGuardRef.current) return
    sendingGuardRef.current = true
    setSending(true)
    setError(null)
    try {
      await api.delete(`/activity-discussions/${messageId}/`)
      setMessages((current) => current.filter((message) => String(message.id) !== String(messageId)))
      if (String(editingId) === String(messageId)) {
        setEditingId(null)
        setNewMessage('')
      }
    } catch (err) {
      console.error('Failed to delete message', err)
      setError('Unable to delete message.')
    } finally {
      sendingGuardRef.current = false
      setSending(false)
    }
  }

  const groupedMessages = useMemo(() => {
    const groups = []
    let currentDate = null
    messages.forEach((message) => {
      const ts = new Date(message.created_at)
      const dayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(ts)
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
    return String(message.sender) === String(user.id) || ['instructor', 'admin'].includes(String(user.role).toLowerCase())
  }

  const messageRows = groupedMessages.map((item) => {
      if (item.type === 'date') {
        return (
          <div key={item.key} className="flex w-full justify-center border-b border-slate-200 py-2">
            <span className="bg-white px-3 text-xs font-semibold text-slate-500">
              {formatDateSeparator(item.date)}
            </span>
          </div>
        )
      }

      const message = item.message
      const senderName = `${message.sender_name || ''} ${message.sender_last_name || ''}`.trim() || 'Unknown'
      const isInstructor = String(message.sender_role).toLowerCase() === 'instructor'

      return (
        <article key={item.key} className="border-b border-slate-200 py-4 last:border-b-0">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className="font-semibold text-[#082b53]">{senderName}</h4>
              <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${isInstructor ? 'bg-[#eaf2fb] text-[#082b53]' : 'bg-slate-100 text-slate-600'}`}>{isInstructor ? 'Instructor' : 'Student'}</span>
            </div>
            <time className="text-xs text-slate-500">{formatDateTime(message.created_at)}</time>
          </header>
          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{message.message}</div>
          {message.attachments?.length > 0 && <div className="mt-3"><AcademicFileAttachments attachments={message.attachments} kind="discussion" /></div>}
          {canModify(message) && <div className="mt-2 flex gap-3"><button type="button" onClick={() => startEdit(message)} className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-[#1d5b91] hover:underline"><Edit3 size={13} />Edit</button><button type="button" onClick={() => deleteMessage(message.id)} className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-red-700 hover:underline"><Trash2 size={13} />Delete</button></div>}
        </article>
      )
    })

  return (
    <section className="relative flex min-h-0 flex-col rounded-2xl border border-[#dbe5f0] bg-white shadow-[0_12px_34px_rgba(25,55,89,0.08)]">
      <div className="flex-shrink-0 flex items-center justify-between gap-4 border-b border-[#e7edf4] px-5 py-4 sm:px-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Discussion</h3>
          <p className="text-sm text-slate-500">Classroom discussion for this activity.</p>
        </div>
        <button onClick={fetchMessages} className="rounded-xl border border-[#dbe5f0] bg-white px-3 py-2 text-sm font-semibold text-[#28415f] transition hover:bg-[#f7f9fc]">
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 px-4 sm:px-6">
        <div ref={discussionRef} className="flex h-auto min-h-0 flex-col divide-y divide-slate-200 overflow-visible pr-2 pb-3 pt-5">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center"><div><p className="font-semibold text-[#28415f]">No messages yet.</p><p className="mt-1 text-sm text-slate-500">Start a discussion about this activity.</p></div></div>
          ) : (
            <div>{messageRows}</div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-[#e7edf4] bg-white px-4 py-4 sm:px-6">
        {error && <div role="alert" className="mb-3 rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1"><label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="discussion-message">Message</label><textarea
            id="discussion-message"
            ref={composerRef}
            value={newMessage}
            onChange={(event) => setNewMessage(event.target.value)}
            rows={2}
            placeholder={editingId ? 'Edit message…' : 'Write a message…'}
            disabled={loading || sending}
            className="min-h-[84px] w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-900"
          /></div>
          <div className="flex flex-col gap-3 sm:w-auto sm:flex-row">
            <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-900">
              <Paperclip size={16} /> Attach
              <input
                type="file"
                className="hidden"
                disabled={loading || sending}
                onChange={(event) => setAttachment(event.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              onClick={handleSend}
              disabled={loading || sending || (!newMessage.trim() && !attachment)}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#F5B700] px-5 py-3 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send size={16} /> {editingId ? 'Save' : 'Send'}
            </button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); setNewMessage(''); setError(null) }} disabled={sending} className="min-h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel edit</button>}
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
