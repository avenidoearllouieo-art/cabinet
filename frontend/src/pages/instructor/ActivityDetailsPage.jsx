import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  Download,
  FileText,
  Users,
  Clock3,
  Copy,
  Archive,
  Eye,
  MoreHorizontal,
  CheckCircle2,
  Star,
  Paperclip,
  BadgeCheck,
  BookOpen,
} from 'lucide-react'
import api from '../../services/api.js'
import ActivityAnnouncements from '../../components/ActivityAnnouncements.jsx'
import ActivityDiscussion from '../../components/ActivityDiscussion'

const formatDateTime = (value) => {
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

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

const formatBytes = (bytes) => {
  if (bytes == null) return '—'
  const kb = 1024
  if (bytes < kb) return `${bytes} B`
  const mb = kb * 1024
  if (bytes < mb) return `${(bytes / kb).toFixed(1)} KB`
  return `${(bytes / mb).toFixed(1)} MB`
}

const getFileIcon = (name = '') => {
  const lower = String(name).toLowerCase()
  if (lower.endsWith('.pdf')) return 'PDF'
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'DOC'
  if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) return 'PPT'
  if (lower.match(/\.(png|jpg|jpeg|gif|webp)$/)) return 'IMG'
  if (lower.endsWith('.zip')) return 'ZIP'
  return 'FILE'
}

const getStatusBadge = (activity, dueDate) => {
  const status = String(activity?.status || '').toLowerCase()
  if (status === 'archived') {
    return { label: 'Archived', classes: 'bg-slate-900 text-white' }
  }

  if (!dueDate) {
    return { label: 'Active', classes: 'bg-emerald-100 text-emerald-700' }
  }

  const due = new Date(dueDate)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return { label: 'Overdue', classes: 'bg-rose-100 text-rose-700' }
  }
  if (diffDays === 0) {
    return { label: 'Due Today', classes: 'bg-amber-100 text-amber-700' }
  }
  return { label: 'Active', classes: 'bg-emerald-100 text-emerald-700' }
}

const renderInlineText = (text = '') => {
  const segments = String(text).split(/(https?:\/\/\S+)/g)
  return segments.map((segment, index) => {
    if (/^https?:\/\//.test(segment)) {
      return <a key={`${segment}-${index}`} href={segment} target="_blank" rel="noreferrer" className="text-blue-700 underline">{segment}</a>
    }
    return <span key={`${segment}-${index}`} style={{ whiteSpace: 'pre-wrap' }}>{segment}</span>
  })
}

const parseInstructionBlocks = (content = '') => {
  const lines = String(content).split(/\r?\n/)
  const blocks = []
  let paragraphBuffer = []
  let listType = null
  let listItems = []
  let codeBuffer = []
  let inCodeBlock = false

  const flushParagraph = () => {
    if (paragraphBuffer.length) {
      const text = paragraphBuffer.join(' ').trim()
      if (text) {
        blocks.push(
          <p key={`paragraph-${blocks.length}`} className="text-[15px] leading-8 text-slate-700">
            {renderInlineText(text)}
          </p>,
        )
      }
      paragraphBuffer = []
    }
  }

  const flushList = () => {
    if (!listType || !listItems.length) return
    if (listType === 'ul') {
      blocks.push(
        <ul key={`list-${blocks.length}`} className="ml-5 list-disc space-y-2 text-[15px] leading-8 text-slate-700">
          {listItems.map((item, index) => <li key={`${listType}-${index}`}>{renderInlineText(item)}</li>)}
        </ul>,
      )
    } else {
      blocks.push(
        <ol key={`list-${blocks.length}`} className="ml-5 list-decimal space-y-2 text-[15px] leading-8 text-slate-700">
          {listItems.map((item, index) => <li key={`${listType}-${index}`}>{renderInlineText(item)}</li>)}
        </ol>,
      )
    }
    listType = null
    listItems = []
  }

  const flushCodeBlock = () => {
    if (!codeBuffer.length) return
    blocks.push(
      <pre key={`code-${blocks.length}`} className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-sm leading-7 text-slate-100">
        <code>{codeBuffer.join('\n')}</code>
      </pre>,
    )
    codeBuffer = []
  }

  lines.forEach((line) => {
    const trimmed = line.trim()

    if (trimmed === '```') {
      flushParagraph()
      flushList()
      if (inCodeBlock) {
        flushCodeBlock()
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      return
    }

    if (inCodeBlock) {
      codeBuffer.push(line)
      return
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
        listItems = []
      }
      listItems.push(trimmed.replace(/^[-*]\s+/, ''))
      return
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph()
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
        listItems = []
      }
      listItems.push(trimmed.replace(/^\d+\.\s+/, ''))
      return
    }

    if (!trimmed) {
      flushParagraph()
      flushList()
      return
    }

    paragraphBuffer.push(trimmed)
  })

  flushParagraph()
  flushList()
  if (inCodeBlock && codeBuffer.length) {
    flushCodeBlock()
  }

  return blocks.length ? blocks : [<p key="instructions-fallback" className="text-[15px] leading-8 text-slate-700">No instructions provided.</p>]
}

const rubricRows = [
  { label: 'Functionality', points: 40 },
  { label: 'Documentation', points: 30 },
  { label: 'UI Design', points: 20 },
  { label: 'Submission', points: 10 },
]

const buildTimeline = (submissionsCount) => [
  { id: 1, label: 'Activity Created', timestamp: '2026-07-24T10:00:00Z', icon: '●' },
  { id: 2, label: 'Announcement Posted', timestamp: '2026-07-27T09:05:00Z', icon: '📣' },
  { id: 3, label: `Student Submitted (${submissionsCount})`, timestamp: '2026-07-27T10:15:00Z', icon: '📄' },
  { id: 4, label: 'Submission Graded', timestamp: '2026-07-27T11:20:00Z', icon: '⭐' },
  { id: 5, label: 'Activity Edited', timestamp: '2026-07-27T12:00:00Z', icon: '✏️' },
]

export default function ActivityDetailsPage() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [activity, setActivity] = useState(location.state?.activity || null)
  const [loading, setLoading] = useState(!location.state?.activity)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    const fetchActivity = async () => {
      if (!activityId) return
      try {
        setLoading(true)
        const response = await api.get(`/activities/${activityId}/`)
        setActivity(response.data || null)
        setError('')
      } catch (err) {
        console.error('Failed to load activity details', err)
        setError('Unable to load the full activity details right now. Showing the latest local view instead.')
      } finally {
        setLoading(false)
      }
    }

    fetchActivity()
  }, [activityId])

  const assignedSections = useMemo(() => {
    if (!activity) return []
    if (Array.isArray(activity.assigned_sections)) {
      return activity.assigned_sections.map((section) => (typeof section === 'object' ? section.section_name || section.name || 'Unnamed section' : section)).filter(Boolean)
    }
    return []
  }, [activity])

  const submissions = useMemo(() => [
    { id: 1, studentName: 'Alina Reyes', studentId: '20240021', section: 'BSIT-201', status: 'Submitted', score: 92, submittedAt: '2026-07-27T10:15:00Z' },
    { id: 2, studentName: 'Ben Morales', studentId: '20240022', section: 'BSIT-202', status: 'Pending', score: null, submittedAt: null },
    { id: 3, studentName: 'Clara Bautista', studentId: '20240023', section: 'BSIT-201', status: 'Late', score: 74, submittedAt: '2026-07-25T08:10:00Z' },
  ], [])

  const analyticsBaseCount = activity?.assigned_student_count || 24
  const analytics = useMemo(() => {
    const submitted = submissions.filter((submission) => ['submitted', 'graded', 'returned'].includes(String(submission.status || '').toLowerCase())).length
    const pending = submissions.filter((submission) => String(submission.status || '').toLowerCase() === 'pending').length
    const late = submissions.filter((submission) => String(submission.status || '').toLowerCase() === 'late').length
    const gradedScores = submissions.filter((submission) => typeof submission.score === 'number').map((submission) => submission.score)
    const averageScore = gradedScores.length ? Math.round(gradedScores.reduce((sum, score) => sum + score, 0) / gradedScores.length) : 0
    const highestScore = gradedScores.length ? Math.max(...gradedScores) : 0
    const lowestScore = gradedScores.length ? Math.min(...gradedScores) : 0
    const submissionRate = analyticsBaseCount ? Math.round((submitted / analyticsBaseCount) * 100) : 0
    return {
      assignedStudents: activity?.assigned_student_count || 24,
      submitted,
      pending,
      late,
      averageScore,
      highestScore,
      lowestScore,
      submissionRate,
    }
  }, [activity, submissions, analyticsBaseCount])

  const statusBadge = getStatusBadge(activity, activity?.due_date)
  const dueDate = activity?.due_date
  const dueCountdown = useMemo(() => {
    if (!dueDate) return null
    const due = new Date(dueDate)
    const now = new Date()
    const diffMs = due.getTime() - now.getTime()
    if (Number.isNaN(diffMs)) return null
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return 'Overdue'
    if (diffDays === 0) return 'Due today'
    return `${diffDays} day${diffDays === 1 ? '' : 's'} left`
  }, [dueDate])

  const attachments = useMemo(() => Array.isArray(activity?.attachments) ? activity.attachments : [], [activity])
  const metricCards = useMemo(() => [
    { label: 'Assigned Students', value: analytics.assignedStudents, tone: 'bg-blue-50 text-blue-700' },
    { label: 'Submitted', value: analytics.submitted, tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Pending', value: analytics.pending, tone: 'bg-amber-50 text-amber-700' },
    { label: 'Average Score', value: `${analytics.averageScore}%`, tone: 'bg-violet-50 text-violet-700' },
    { label: 'Highest Score', value: analytics.highestScore, tone: 'bg-cyan-50 text-cyan-700' },
    { label: 'Lowest Score', value: analytics.lowestScore, tone: 'bg-rose-50 text-rose-700' },
    { label: 'Submission Rate', value: `${analytics.submissionRate}%`, tone: 'bg-slate-100 text-slate-700' },
  ], [analytics])

  const progressRows = useMemo(() => [
    { label: 'Submitted', value: analytics.submitted, max: analytics.assignedStudents, tone: 'bg-blue-600' },
    { label: 'Pending', value: analytics.pending, max: analytics.assignedStudents, tone: 'bg-slate-400' },
    { label: 'Late', value: analytics.late, max: analytics.assignedStudents, tone: 'bg-amber-500' },
    { label: 'Graded', value: submissions.filter((submission) => typeof submission.score === 'number').length, max: analytics.assignedStudents, tone: 'bg-emerald-600' },
  ], [analytics, submissions])

  const handleArchive = () => {
    const confirmed = window.confirm('Archive this activity?')
    if (!confirmed) return
    setToastMessage('Activity archived.')
    window.setTimeout(() => setToastMessage(''), 2500)
  }

  const handleDuplicate = () => {
    setToastMessage('Duplicate activity action ready for backend sync.')
    window.setTimeout(() => setToastMessage(''), 2500)
  }

  const handleExport = () => {
    const payload = submissions.map((item) => ({ ...item }))
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(activity?.title || 'activity').toLowerCase().replace(/\s+/g, '-') || 'activity'}-submissions.json`
    link.click()
    window.URL.revokeObjectURL(url)
    setToastMessage('Submission list exported.')
    window.setTimeout(() => setToastMessage(''), 2500)
  }

  const renderLoadingSkeleton = () => (
    <div className="grid gap-6 xl:grid-cols-[1.45fr_0.65fr]">
      <div className="space-y-6">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-32 animate-pulse rounded-[20px] border border-slate-200 bg-slate-50" />
        ))}
      </div>
      <div className="space-y-6">
        {[1, 2].map((item) => (
          <div key={item} className="h-40 animate-pulse rounded-[20px] border border-slate-200 bg-slate-50" />
        ))}
      </div>
    </div>
  )

  const instructionBlocks = useMemo(() => parseInstructionBlocks(activity?.instructions || ''), [activity])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <button type="button" onClick={() => navigate('/instructor/activities')} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
              <ArrowLeft size={16} /> Activities
            </button>
            <span>/</span>
            <span className="font-semibold text-slate-700">Activity Details</span>
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{activity?.title || 'Activity Details'}</h1>
            <p className="text-sm text-slate-600 sm:text-[15px]">Assignment • {assignedSections[0] || 'Section A'} • Due {formatDate(activity?.due_date)}</p>
          </div>
        </div>
        <div className="relative">
          <button onClick={() => setMenuOpen((current) => !current)} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
            <MoreHorizontal size={16} /> Actions
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-2 w-48 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
              <button onClick={() => { setMenuOpen(false); setToastMessage('Edit workflow is available from the activity list.') }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                <PencilLine size={15} /> Edit
              </button>
              <button onClick={() => { setMenuOpen(false); handleDuplicate() }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                <Copy size={15} /> Duplicate
              </button>
              <button onClick={() => { setMenuOpen(false); handleArchive() }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-50">
                <Archive size={15} /> Archive
              </button>
              <button onClick={() => { setMenuOpen(false); setToastMessage('Delete action is still handled from the activity list.') }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-700 transition hover:bg-rose-50">
                <Trash2 size={15} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">{error}</div>}

      {loading ? (
        renderLoadingSkeleton()
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.45fr_0.65fr]">
          <div className="space-y-6">
            <section className="rounded-[24px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.2)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusBadge.classes}`}>{statusBadge.label}</span>
                  <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">{activity?.activity_type || 'Assignment'}</span>
                  {dueCountdown && <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{dueCountdown}</span>}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                  <Star size={14} className="text-amber-500" /> {activity?.max_score || 100} pts
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                  <CalendarDays size={14} className="text-blue-600" /> {formatDateTime(activity?.due_date)}
                </span>
              </div>

              <p className="mt-5 text-[15px] leading-8 text-slate-700">{activity?.description || 'No description provided.'}</p>
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.2)]">
              <div className="flex items-center gap-2 text-slate-700">
                <BookOpen size={18} className="text-blue-600" />
                <h3 className="text-lg font-semibold">Overview</h3>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: 'Section', value: assignedSections.length ? assignedSections.join(', ') : 'Section A', icon: ClipboardList },
                  { label: 'Created', value: formatDate(activity?.created_at), icon: CalendarDays },
                  { label: 'Due Date', value: formatDateTime(activity?.due_date), icon: CalendarDays },
                  { label: 'Maximum Score', value: `${activity?.max_score || 100} pts`, icon: Star },
                  { label: 'Attachments', value: `${attachments.length} file${attachments.length === 1 ? '' : 's'}`, icon: Paperclip },
                  { label: 'Submission Type', value: 'Online / Classroom', icon: FileText },
                ].map((item) => {
                  const Icon = item.icon
                  return (
                    <div key={item.label} className="rounded-[16px] border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <Icon size={16} className="text-blue-600" />
                        {item.label}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-slate-700">{item.value}</p>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.2)]">
              <div className="flex items-center gap-2 text-slate-700">
                <FileText size={18} className="text-blue-600" />
                <h3 className="text-lg font-semibold">Instructions</h3>
              </div>
              <div className="mt-5 space-y-4 rounded-[18px] border border-slate-200 bg-slate-50 p-5">
                {instructionBlocks}
              </div>
            </section>

            {/* Rubric removed per UI update request */}

            <section className="rounded-[24px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.2)]">
              <div className="flex items-center gap-2 text-slate-700">
                <Paperclip size={18} className="text-blue-600" />
                <h3 className="text-lg font-semibold">Attachments</h3>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {attachments.length ? attachments.map((attachment, index) => {
                  const fileName = attachment.filename || attachment.file_name || attachment.file || 'Attachment'
                  const fileUrl = attachment.url || attachment.download_url || attachment.file || '#'
                  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(fileName) || /\.(png|jpg|jpeg|gif|webp)$/i.test(String(fileUrl))
                  const isPreviewable = isImage || fileName.toLowerCase().endsWith('.pdf')

                  return (
                    <div key={`${fileName}-${index}`} className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
                      {isImage && fileUrl ? (
                        <img src={fileUrl} alt={fileName} className="mb-3 h-24 w-full rounded-[12px] object-cover" />
                      ) : (
                        <div className="mb-3 flex h-24 items-center justify-center rounded-[12px] border border-dashed border-slate-300 bg-white text-2xl font-semibold text-slate-500">
                          {getFileIcon(fileName)}
                        </div>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{fileName}</p>
                          <p className="mt-1 text-sm text-slate-500">{formatBytes(attachment.size || attachment.file_size)} • {formatDate(attachment.uploaded_at || attachment.created_at)}</p>
                        </div>
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{getFileIcon(fileName)}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <a href={fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">
                          <Download size={15} /> Download
                        </a>
                        {isPreviewable && (
                          <button onClick={() => window.open(fileUrl, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                            <Eye size={15} /> Preview
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }) : (
                  <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500 md:col-span-2">No attachments available yet.</div>
                )}
              </div>
            </section>

            <ActivityAnnouncements activityId={activity?.id} />
            <ActivityDiscussion activityId={activity?.id} />
          </div>

          <aside className="space-y-6">
            <section className="rounded-[24px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.2)]">
              <div className="flex items-center gap-2 text-slate-700">
                <ClipboardList size={18} className="text-blue-600" />
                <h3 className="text-lg font-semibold">Submission Summary</h3>
              </div>
              <div className="mt-5 space-y-3">
                {progressRows.map((row) => {
                  const percent = Math.min(100, Math.max(8, Math.round((row.value / Math.max(row.max, 1)) * 100)))
                  return (
                    <div key={row.label}>
                      <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-700">
                        <span>{row.label}</span>
                        <span>{row.value}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-slate-100">
                        <div className={`h-2.5 rounded-full ${row.tone}`} style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <button onClick={() => navigate(`/instructor/submissions?activity=${activityId}`)} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700">
                <Eye size={16} /> Quick View Student Submissions
              </button>
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.2)]">
              <div className="flex items-center gap-2 text-slate-700">
                <Users size={18} className="text-blue-600" />
                <h3 className="text-lg font-semibold">Activity Statistics</h3>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {metricCards.map((card) => (
                  <div key={card.label} className={`rounded-[16px] border border-slate-200 p-4 ${card.tone}`}>
                    <p className="text-sm font-medium">{card.label}</p>
                    <p className="mt-2 text-2xl font-semibold">{card.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button onClick={handleExport} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                  <Download size={15} /> Export Submission List
                </button>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.2)]">
              <div className="flex items-center gap-2 text-slate-700">
                <Clock3 size={18} className="text-blue-600" />
                <h3 className="text-lg font-semibold">Recent Activity</h3>
              </div>
              <div className="mt-5 space-y-4">
                {buildTimeline(submissions.length).map((event) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm text-blue-700">{event.icon}</div>
                      <div className="mt-2 h-full w-px bg-slate-200" />
                    </div>
                    <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 flex-1">
                      <p className="font-semibold text-slate-900">{event.label}</p>
                      <p className="mt-1 text-sm text-slate-600">{formatDateTime(event.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-6 right-6 rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
