import { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal.jsx'
import api from '../../services/api.js'

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch (err) {
    return String(value)
  }
}

const resolveActivityType = (submission) => {
  if (!submission) return '—'
  return (
    submission.activity_type ||
    submission.activity?.activity_type ||
    submission.activity?.type ||
    '—'
  )
}

const resolveStatus = (submission) => {
  if (!submission) return 'Unknown'
  const raw = submission.status ? String(submission.status).toLowerCase() : null
  if (raw === 'graded') return 'Graded'
  if (raw === 'late') return 'Late'
  if (raw === 'submitted') return 'Submitted'
  if (raw === 'pending') return 'Pending'

  if (submission.score != null) return 'Graded'
  if (submission.file || submission.submitted_at) return 'Submitted'
  return 'Pending'
}

const buildFileUrl = (filePath) => {
  if (!filePath) return null
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
  return `${window.location.origin}${filePath}`
}

export default function ViewSubmissionModal({ isOpen, submissionId, submission, onClose, onUnauthorized }) {
  const [details, setDetails] = useState(submission || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setError('')

    if (submission) {
      setDetails(submission)
      setLoading(false)
      return
    }

    if (submissionId) {
      setDetails(null)
      fetchSubmission(submissionId)
      return
    }

    setDetails(null)
  }, [isOpen, submissionId, submission])

  const fetchSubmission = async (id) => {
    setLoading(true)
    try {
      const response = await api.get(`/submissions/${id}/`)
      setDetails(response.data)
      setError('')
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized && onUnauthorized()
      } else {
        console.error('Error loading submission details:', err)
        setError('Failed to load submission details.')
      }
    } finally {
      setLoading(false)
    }
  }

  const fileUrl = useMemo(() => buildFileUrl(details?.file), [details])
  const fileName = useMemo(() => {
    if (!details?.file) return ''
    const parts = details.file.split('/')
    return parts[parts.length - 1]
  }, [details])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="View Submission">
      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">Loading submission details...</div>
      ) : !details ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">No submission details available.</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-[#6B7280]">Student Name</p>
              <p className="mt-1 text-sm text-[#111827]">{details?.student_name || `${details?.student?.first_name || ''} ${details?.student?.last_name || ''}`.trim() || '—'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#6B7280]">Student ID</p>
              <p className="mt-1 text-sm text-[#111827]">{details?.student?.student_id || '—'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#6B7280]">Section</p>
              <p className="mt-1 text-sm text-[#111827]">{details?.student?.section_name || details?.student?.section?.section_name || '—'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#6B7280]">Activity</p>
              <p className="mt-1 text-sm text-[#111827]">{details?.activity_title || details?.activity?.title || '—'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#6B7280]">Activity Type</p>
              <p className="mt-1 text-sm text-[#111827]">{resolveActivityType(details)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#6B7280]">Submission Date</p>
              <p className="mt-1 text-sm text-[#111827]">{formatDate(details?.submitted_at)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#6B7280]">Due Date</p>
              <p className="mt-1 text-sm text-[#111827]">{formatDate(details?.activity?.due_date)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#6B7280]">Score</p>
              <p className="mt-1 text-sm text-[#111827]">{details?.score != null ? details.score : '—'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#6B7280]">Status</p>
              <p className="mt-1 text-sm text-[#111827]">{resolveStatus(details)}</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-[#6B7280]">Remarks</p>
            <p className="mt-1 whitespace-pre-wrap rounded-[12px] border border-[#E5E7EB] bg-[#F8FAFC] p-4 text-sm text-[#111827]">{details?.remarks || '—'}</p>
          </div>

          <div>
            <p className="text-sm font-medium text-[#6B7280]">Submission File</p>
            {details?.file ? (
              <div className="mt-2 flex flex-col gap-3 rounded-[12px] border border-[#E5E7EB] bg-[#F8FAFC] p-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-[#111827]">{fileName}</span>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Download
                </a>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[#6B7280]">No submission file available.</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-[#F3F4F6] px-4 py-2 text-sm font-semibold text-[#111827] transition hover:bg-[#E5E7EB]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
