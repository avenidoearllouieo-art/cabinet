import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../services/api.js'

export default function EditActivityModal({ isOpen, activityId, activity, onClose, onUnauthorized, onSaved }) {
  const resolvedActivityId = activity?.id ?? activityId
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sections, setSections] = useState([])
  const [loadingSections, setLoadingSections] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [existingAttachments, setExistingAttachments] = useState([])
  const [deletedAttachmentIds, setDeletedAttachmentIds] = useState([])

  const blank = {
    title: '',
    description: '',
    instructions: '',
    section: '',
    due_date: '',
    due_time: '',
    max_score: '',
    cabinet_station: '',
    status: 'Published',
    files: [],
  }

  const [form, setForm] = useState(blank)

  useEffect(() => {
    if (!isOpen) return
    setErrors({})
    setFormError('')
    setSuccessMessage('')
    setForm(blank)
    setExistingAttachments([])
    setDeletedAttachmentIds([])
    fetchSections()
    if (resolvedActivityId) {
      fetchActivity(resolvedActivityId)
    }
  }, [isOpen, resolvedActivityId])

  const fetchSections = async () => {
    setLoadingSections(true)
    try {
      const res = await api.get('/sections/')
      setSections(Array.isArray(res.data) ? res.data : res.data.results || [])
    } catch (e) {
      if (e.response?.status === 401) {
        onUnauthorized && onUnauthorized()
      } else {
        console.error('Failed to load sections', e)
      }
    } finally {
      setLoadingSections(false)
    }
  }

  const fetchActivity = async (id) => {
    setLoading(true)
    try {
      const res = await api.get(`/activities/${id}/`)
      const data = res.data || {}
      let dueDate = ''
      let dueTime = ''
      if (data.due_date) {
        const [datePart, timePart] = data.due_date.split('T')
        dueDate = datePart || ''
        dueTime = timePart ? timePart.slice(0, 5) : ''
      }
      const loaded = {
        title: data.title || '',
        description: data.description || '',
        instructions: data.instructions || '',
        section: data.section || '',
        due_date: dueDate,
        due_time: dueTime,
        max_score: data.max_score !== undefined ? String(data.max_score) : '',
        cabinet_station: data.cabinet_station || '',
        status: data.status || 'Published',
        files: [],
      }
      setForm(loaded)
      setExistingAttachments(data.attachments || [])
    } catch (e) {
      if (e.response?.status === 401) {
        onUnauthorized && onUnauthorized()
      } else {
        console.error('Failed to load activity', e)
        setFormError('Failed to load activity.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (key) => (e) => {
    const value = e && e.target ? e.target.value : e
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((errs) => ({ ...errs, [key]: undefined }))
    setFormError('')
  }

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || [])
    setForm((f) => ({ ...f, files: selected }))
  }

  const handleRemoveAttachment = (attachmentId) => {
    setExistingAttachments((prev) => prev.filter((att) => att.id !== attachmentId))
    setDeletedAttachmentIds((prev) => [...prev, attachmentId])
  }

  const handleSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault()
    setSaving(true)
    setErrors({})
    setFormError('')
    setSuccessMessage('')

    if (!resolvedActivityId) {
      setFormError('Missing activity id')
      setSaving(false)
      return
    }

    const dueDateTime = form.due_date && form.due_time ? `${form.due_date}T${form.due_time}` : form.due_date || null
    const payload = {
      title: form.title,
      description: form.description,
      instructions: form.instructions,
      section: form.section || null,
      due_date: dueDateTime,
      max_score: form.max_score ? Number(form.max_score) : 100,
      cabinet_station: form.cabinet_station || '',
      status: form.status,
    }

    try {
      const formData = new FormData()
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          formData.append(key, value)
        }
      })
      form.files.forEach((file) => formData.append('attachments', file))
      deletedAttachmentIds.forEach((id) => formData.append('deleted_attachments', id))

      const res = await api.patch(`/activities/${resolvedActivityId}/`, formData)
      onSaved && onSaved(res.data)
      setExistingAttachments(res.data.attachments || [])
      setForm((prev) => ({ ...prev, files: [] }))
      setDeletedAttachmentIds([])
      setSuccessMessage('Activity updated successfully. Attachment changes were saved.')
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }
      const data = err.response?.data
      if (data && typeof data === 'object') {
        setErrors(data)
        if (typeof data.detail === 'string') setFormError(data.detail)
      } else {
        setFormError('Failed to save changes. Please try again.')
        console.error('Failed to save activity', err)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !resolvedActivityId) {
    return null
  }

  const title = 'Edit Activity'
  const submitLabel = 'Save Changes'

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">{title}</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Update the existing activity details.</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl font-bold text-[#475569] transition hover:text-[#0F172A]" aria-label="Close modal">
            ×
          </button>
        </div>

        {formError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
        )}

        {successMessage && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div>
        )}

        {loading ? (
          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Activity Title</label>
              <input value={form.title} onChange={handleChange('title')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.title && <p className="mt-1 text-xs text-red-600">{String(errors.title)}</p>}
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
              <textarea value={form.description} onChange={handleChange('description')} rows="3" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.description && <p className="mt-1 text-xs text-red-600">{String(errors.description)}</p>}
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Instructions (Rich Text)</label>
              <textarea value={form.instructions} onChange={handleChange('instructions')} placeholder="Paste or type detailed instructions here..." rows="4" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.instructions && <p className="mt-1 text-xs text-red-600">{String(errors.instructions)}</p>}
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Section</label>
              <select value={form.section} onChange={handleChange('section')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">Select a section</option>
                {sections.map((section) => (
                  <option key={section.id || section.section_code || section.section_id} value={section.id || section.section_code || section.section_id}>
                    {section.section_name || section.name || section.section_code || 'Unnamed section'}
                  </option>
                ))}
              </select>
              {errors.section && <p className="mt-1 text-xs text-red-600">{String(errors.section)}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Due Date</label>
              <input type="date" value={form.due_date} onChange={handleChange('due_date')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.due_date && <p className="mt-1 text-xs text-red-600">{String(errors.due_date)}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Due Time</label>
              <input type="time" value={form.due_time} onChange={handleChange('due_time')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.due_time && <p className="mt-1 text-xs text-red-600">{String(errors.due_time)}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Upload Files</label>
              <input type="file" multiple onChange={handleFileChange} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {form.files.length > 0 && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-700">New files to upload</p>
                  <ul className="mt-2 space-y-1">
                    {form.files.map((file) => (
                      <li key={`${file.name}-${file.size}`} className="truncate">• {file.name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Maximum Score</label>
              <input type="number" value={form.max_score} onChange={handleChange('max_score')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.max_score && <p className="mt-1 text-xs text-red-600">{String(errors.max_score)}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Cabinet Station (optional)</label>
              <input type="text" value={form.cabinet_station} onChange={handleChange('cabinet_station')} placeholder="e.g., Cabinet 1" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.cabinet_station && <p className="mt-1 text-xs text-red-600">{String(errors.cabinet_station)}</p>}
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
              <select value={form.status} onChange={handleChange('status')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
                <option value="Published">Published</option>
                <option value="Draft">Draft</option>
                <option value="Scheduled">Scheduled</option>
                <option value="Archived">Archived</option>
                <option value="Closed">Closed</option>
              </select>
              {errors.status && <p className="mt-1 text-xs text-red-600">{String(errors.status)}</p>}
            </div>

            <div className="md:col-span-2">
              <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">Existing Attachments</p>
                  <span className="text-xs text-slate-500">Remove files before saving</span>
                </div>
                <div className="mt-3 space-y-3">
                  {existingAttachments.length ? (
                    existingAttachments.map((attachment) => (
                      <div key={attachment.id} className="flex flex-col gap-3 rounded-[12px] border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-slate-900">{attachment.filename || attachment.file_name || attachment.file || 'Attachment'}</p>
                          <p className="text-sm text-slate-500">{attachment.size ? `${attachment.size} bytes` : attachment.file_size ? `${attachment.file_size} bytes` : ''}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {(attachment.url || attachment.download_url) && (
                            <a href={attachment.url || attachment.download_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
                              Download
                            </a>
                          )}
                          <button type="button" onClick={() => handleRemoveAttachment(attachment.id)} className="rounded-full border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[12px] border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">No existing files.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving || loading}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving && (
              <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
              </svg>
            )}
            {submitLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
