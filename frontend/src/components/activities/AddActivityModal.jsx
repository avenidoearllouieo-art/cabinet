import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../services/api.js'

const getBlankForm = () => ({
  title: '',
  description: '',
  due_date: '',
})

export default function AddActivityModal({ isOpen, onClose, onUnauthorized, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState(getBlankForm())

  useEffect(() => {
    if (!isOpen) return
    setErrors({})
    setFormError('')
    setForm(getBlankForm())
  }, [isOpen])

  const handleChange = (key) => (e) => {
    const value = e && e.target ? e.target.value : e
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((errs) => ({ ...errs, [key]: undefined }))
    setFormError('')
  }

  const handleSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault()
    setSaving(true)
    setErrors({})
    setFormError('')

    const payload = {
      title: form.title,
      description: form.description,
      due_date: form.due_date || null,
    }

    try {
      const res = await api.post('/activities/', payload)
      onSaved && onSaved(res.data)
      onClose && onClose()
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }

      const data = err.response?.data
      if (data && typeof data === 'object') {
        setErrors(data)
        if (typeof data.detail === 'string') {
          setFormError(data.detail)
        }
      } else {
        setFormError('Failed to create activity. Please try again.')
        console.error('Failed to create activity', err)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const title = 'Create New Activity'
  const submitLabel = 'Create Activity'
  const helperText = 'Set up a new activity for your students to complete.'

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">{title}</h2>
            <p className="mt-1 text-sm text-[#6B7280]">{helperText}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl font-bold text-[#475569] transition hover:text-[#0F172A]" aria-label="Close modal">
            ×
          </button>
        </div>

        {formError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Activity Title *</label>
            <input 
              type="text"
              value={form.title} 
              onChange={handleChange('title')} 
              placeholder="e.g., Chapter 5 Assignment"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" 
            />
            {errors.title && <p className="mt-1 text-xs text-red-600">{String(errors.title)}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea 
              value={form.description} 
              onChange={handleChange('description')} 
              placeholder="Describe the activity, instructions, requirements..."
              rows="4"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" 
            />
            {errors.description && <p className="mt-1 text-xs text-red-600">{String(errors.description)}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Due Date</label>
            <input 
              type="datetime-local" 
              value={form.due_date} 
              onChange={handleChange('due_date')} 
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" 
            />
            {errors.due_date && <p className="mt-1 text-xs text-red-600">{String(errors.due_date)}</p>}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
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
