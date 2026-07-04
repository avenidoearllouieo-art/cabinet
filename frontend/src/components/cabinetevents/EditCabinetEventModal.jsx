import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../services/api.js'

export default function EditCabinetEventModal({ isOpen, eventId, event, onClose, onUnauthorized, onSaved }) {
  const resolvedEventId = event?.id ?? eventId
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')

  const blank = {
    status: '',
    remarks: '',
  }

  const [form, setForm] = useState(blank)
  const [initialForm, setInitialForm] = useState(blank)

  useEffect(() => {
    if (!isOpen) return
    setErrors({})
    setFormError('')
    setForm(blank)
    setInitialForm(blank)
    if (resolvedEventId) {
      fetchEvent(resolvedEventId)
    }
  }, [isOpen, resolvedEventId])

  const fetchEvent = async (id) => {
    setLoading(true)
    try {
      const res = await api.get(`/cabinet-events/${id}/`)
      const data = res.data || {}
      const loaded = {
        status: data.status || '',
        remarks: data.remarks || '',
      }
      setForm(loaded)
      setInitialForm(loaded)
    } catch (e) {
      if (e.response?.status === 401) {
        onUnauthorized && onUnauthorized()
      } else {
        console.error('Failed to load event', e)
        setFormError('Failed to load event.')
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

  const handleSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault()
    setSaving(true)
    setErrors({})
    setFormError('')

    if (!resolvedEventId) {
      setFormError('Missing event id')
      setSaving(false)
      return
    }

    const payload = {}
    const fields = ['status', 'remarks']
    fields.forEach((field) => {
      if (form[field] !== initialForm[field]) {
        payload[field] = form[field]
      }
    })

    if (Object.keys(payload).length === 0) {
      onSaved && onSaved({ ...form, id: resolvedEventId })
      onClose && onClose()
      setSaving(false)
      return
    }

    try {
      const res = await api.patch(`/cabinet-events/${resolvedEventId}/`, payload)
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
        if (typeof data.detail === 'string') setFormError(data.detail)
      } else {
        setFormError('Failed to save changes. Please try again.')
        console.error('Failed to save event', err)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !resolvedEventId) {
    return null
  }

  const title = 'Edit Cabinet Event'
  const submitLabel = 'Save Changes'

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">{title}</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Update the cabinet event details.</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl font-bold text-[#475569] transition hover:text-[#0F172A]" aria-label="Close modal">
            ×
          </button>
        </div>

        {formError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
        )}

        {loading ? (
          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
              <select value={form.status} onChange={handleChange('status')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">Select status</option>
                <option value="Opened">Opened</option>
                <option value="Closed">Closed</option>
                <option value="Unlocked">Unlocked</option>
                <option value="Locked">Locked</option>
              </select>
              {errors.status && <p className="mt-1 text-xs text-red-600">{String(errors.status)}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Remarks</label>
              <textarea value={form.remarks} onChange={handleChange('remarks')} rows="4" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.remarks && <p className="mt-1 text-xs text-red-600">{String(errors.remarks)}</p>}
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
