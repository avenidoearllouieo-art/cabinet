import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import api from '../../services/api.js'

export default function AddSectionModal({ isOpen, onClose, onUnauthorized, onSaved }) {
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')

  const blank = {
    section_code: '',
    section_name: '',
    program: '',
    year_level: '',
    adviser_instructor: '',
    status: 'Active',
  }

  const [form, setForm] = useState(blank)

  const handleChange = (key) => (e) => {
    const value = e && e.target ? e.target.value : e
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((errs) => ({ ...errs, [key]: undefined }))
    setFormError('')
  }

  const handleSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault()
    setLoading(true)
    setErrors({})
    setFormError('')

    try {
      const res = await api.post('/sections/', form)
      onSaved && onSaved(res.data)
      setForm(blank)
      onClose && onClose()
      return
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
        setFormError('Failed to create section. Please try again.')
        console.error('Failed to create section', err)
      }
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label="Add Section">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">Add Section</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Create a new academic section.</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl font-bold text-[#475569] transition hover:text-[#0F172A]" aria-label="Close modal">
            ×
          </button>
        </div>

        {formError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
        )}

        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Section Code *</label>
            <input
              type="text"
              value={form.section_code}
              onChange={handleChange('section_code')}
              placeholder="e.g., CS-101"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            {errors.section_code && <p className="mt-1 text-xs text-red-600">{String(errors.section_code)}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Section Name *</label>
            <input
              type="text"
              value={form.section_name}
              onChange={handleChange('section_name')}
              placeholder="e.g., A"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            {errors.section_name && <p className="mt-1 text-xs text-red-600">{String(errors.section_name)}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Program *</label>
              <select value={form.program} onChange={handleChange('program')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">Select program</option>
                <option value="BSIT">BSIT</option>
                <option value="BSCS">BSCS</option>
                <option value="BSIS">BSIS</option>
                <option value="Other">Other</option>
              </select>
              {errors.program && <p className="mt-1 text-xs text-red-600">{String(errors.program)}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Year Level *</label>
              <select value={form.year_level} onChange={handleChange('year_level')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">Select year level</option>
                <option value="1st Year">1st Year</option>
                <option value="2nd Year">2nd Year</option>
                <option value="3rd Year">3rd Year</option>
                <option value="4th Year">4th Year</option>
              </select>
              {errors.year_level && <p className="mt-1 text-xs text-red-600">{String(errors.year_level)}</p>}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Adviser / Instructor</label>
            <input
              type="text"
              value={form.adviser_instructor}
              onChange={handleChange('adviser_instructor')}
              placeholder="Enter adviser/instructor name"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            {errors.adviser_instructor && <p className="mt-1 text-xs text-red-600">{String(errors.adviser_instructor)}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
            <select value={form.status} onChange={handleChange('status')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            {errors.status && <p className="mt-1 text-xs text-red-600">{String(errors.status)}</p>}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading && (
              <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
              </svg>
            )}
            Create Section
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
