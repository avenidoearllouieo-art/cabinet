import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import api from '../../services/api.js'

const blank = {
  section_code: '',
  section_name: '',
  program: '',
  year_level: '',
  instructor: '',
  status: 'Active',
}

export default function EditSectionModal({ isOpen, sectionId, section, onClose, onUnauthorized, onSaved }) {
  const resolvedSectionId = section?.id ?? sectionId
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')

  const [instructors, setInstructors] = useState([])
  const [loadingInstructors, setLoadingInstructors] = useState(false)
  const [form, setForm] = useState(blank)
  const [initialForm, setInitialForm] = useState(blank)

  const fetchInstructors = useCallback(async () => {
    setLoadingInstructors(true)
    try {
      const res = await api.get('/users/?role=instructor')
      setInstructors(Array.isArray(res.data) ? res.data : res.data.results || [])
    } catch (e) {
      if (e.response?.status === 401) {
        onUnauthorized && onUnauthorized()
      } else {
        console.error('Failed to load instructors', e)
      }
    } finally {
      setLoadingInstructors(false)
    }
  }, [onUnauthorized])

  const fetchSection = useCallback(async (id) => {
    setLoading(true)
    try {
      const res = await api.get(`/sections/${id}/`)
      const data = res.data || {}
      const loaded = {
        section_code: data.section_code || '',
        section_name: data.section_name || '',
        program: data.program || '',
        year_level: data.year_level || '',
        instructor: data.instructor || '',
        status: data.status || 'Active',
      }
      setForm(loaded)
      setInitialForm(loaded)
    } catch (e) {
      if (e.response?.status === 401) {
        onUnauthorized && onUnauthorized()
      } else {
        console.error('Failed to load section', e)
        setFormError('Failed to load section.')
      }
    } finally {
      setLoading(false)
    }
  }, [onUnauthorized])

  const resetFormState = useCallback(() => {
    setErrors({})
    setFormError('')
    setForm(blank)
    setInitialForm(blank)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const load = async () => {
      resetFormState()
      await fetchInstructors()
      if (resolvedSectionId) {
        await fetchSection(resolvedSectionId)
      }
    }
    load()
  }, [isOpen, resolvedSectionId, resetFormState, fetchInstructors, fetchSection])

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

    if (!resolvedSectionId) {
      setFormError('Missing section id')
      setSaving(false)
      return
    }

    const payload = {}
    const fields = ['section_code', 'section_name', 'program', 'year_level', 'instructor', 'status']
    fields.forEach((field) => {
      const value = field === 'instructor' ? (form.instructor || null) : form[field]
      const initialValue = field === 'instructor' ? (initialForm.instructor || null) : initialForm[field]
      if (value !== initialValue) {
        payload[field] = value
      }
    })

    if (Object.keys(payload).length === 0) {
      onSaved && onSaved({ ...form, id: resolvedSectionId })
      onClose && onClose()
      setSaving(false)
      return
    }

    try {
      let res
      try {
        res = await api.patch(`/sections/${resolvedSectionId}/`, payload)
      } catch (err) {
        if (err.response?.status === 405) {
          res = await api.put(`/sections/${resolvedSectionId}/`, form)
        } else {
          throw err
        }
      }
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
        console.error('Failed to save section', err)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !resolvedSectionId) {
    return null
  }

  const title = 'Edit Section'
  const submitLabel = 'Save Changes'

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">{title}</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Update the section details.</p>
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
              <label className="mb-1 block text-sm font-medium text-slate-700">Instructor</label>
              <select
                value={form.instructor || ''}
                onChange={handleChange('instructor')}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select instructor</option>
                {loadingInstructors ? (
                  <option value="">Loading instructors...</option>
                ) : (
                  instructors.map((instructor) => (
                    <option key={instructor.id} value={instructor.id}>
                      {`${instructor.first_name || ''} ${instructor.last_name || ''}`.trim() || instructor.username}
                    </option>
                  ))
                )}
              </select>
              {errors.instructor && <p className="mt-1 text-xs text-red-600">{String(errors.instructor)}</p>}
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
