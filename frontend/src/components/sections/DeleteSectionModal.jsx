import { useState } from 'react'
import api from '../../services/api.js'
import ConfirmationDialog from '../ConfirmationDialog.jsx'

export default function DeleteSectionModal({ isOpen, section, onClose, onUnauthorized, onDeleted }) {
  const resolvedSectionId = section?.id
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const subjectCode = section?.subject_code || '—'
  const sectionName = section?.section_name || '—'

  const handleDelete = async () => {
    if (!resolvedSectionId) {
      setErrorMessage('Missing section id.')
      return
    }

    setSaving(true)
    setErrorMessage('')

    try {
      await api.delete(`/sections/${resolvedSectionId}/`)
      onDeleted && onDeleted(resolvedSectionId)
      onClose && onClose()
      return
    } catch (err) {
      const status = err.response?.status
      if (status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }
      if (status === 403) {
        setErrorMessage(err.response?.data?.detail || 'Forbidden. You do not have permission to delete this section.')
      } else if (status === 404) {
        setErrorMessage(err.response?.data?.detail || 'Section not found.')
      } else {
        setErrorMessage(err.response?.data?.detail || 'Failed to delete section.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <ConfirmationDialog isOpen={isOpen} title="Delete Section" description="Permanently remove this section." confirmLabel="Delete Section" busyLabel="Deleting..." busy={saving} destructive onConfirm={handleDelete} onCancel={onClose}>
      <div className="space-y-4">
        {errorMessage && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorMessage}</div>}
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-sm font-semibold text-[#082B53]">Subject Code</dt><dd className="mt-1 text-sm text-slate-700">{subjectCode}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Section Name</dt><dd className="mt-1 text-sm text-slate-700">{sectionName}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Year Level</dt><dd className="mt-1 text-sm text-slate-700">{section?.year_level || '—'}</dd></div>
        </dl>
      </div>
    </ConfirmationDialog>
  )
}
