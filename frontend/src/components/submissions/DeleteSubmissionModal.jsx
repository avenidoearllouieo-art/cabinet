import { useState } from 'react'
import Modal from '../Modal.jsx'
import api from '../../services/api.js'

export default function DeleteSubmissionModal({ isOpen, submission, onClose, onUnauthorized, onDeleted }) {
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const handleDelete = async () => {
    if (!submission?.id) {
      setErrorMessage('Missing submission ID.')
      return
    }

    setSaving(true)
    setErrorMessage('')

    try {
      await api.delete(`/submissions/${submission.id}/`)
      onDeleted && onDeleted(submission.id)
      onClose && onClose()
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }
      if (err.response?.data?.detail) {
        setErrorMessage(err.response.data.detail)
      } else {
        setErrorMessage('Failed to delete submission. Please try again.')
      }
      console.error('Failed to delete submission:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Delete Submission">
      <div className="space-y-6">
        <div className="text-sm text-[#6B7280]">
          Are you sure you want to delete this submission? This action cannot be undone.
        </div>

        {submission && (
          <div className="rounded-[12px] border border-[#E5E7EB] bg-[#F8FAFC] p-4 text-sm text-[#111827]">
            <p>
              <span className="font-semibold">Student:</span>{' '}
              {submission.student_name || `${submission.student?.first_name || ''} ${submission.student?.last_name || ''}`.trim() || '—'}
            </p>
            <p className="mt-2">
              <span className="font-semibold">Activity:</span>{' '}
              {submission.activity_title || submission.activity?.title || '—'}
            </p>
          </div>
        )}

        {errorMessage && (
          <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
            {errorMessage}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full bg-[#F3F4F6] px-4 py-2 text-sm font-semibold text-[#111827] transition hover:bg-[#E5E7EB] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            Delete
          </button>
        </div>
      </div>
    </Modal>
  )
}
