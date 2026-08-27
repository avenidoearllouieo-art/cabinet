import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../services/api.js'

const getBlankForm = () => ({
  student_id: '',
  instructor_id: '',
  admin_id: '',
  username: '',
  email: '',
  password: '',
  first_name: '',
  last_name: '',
  role: 'student',
  section: '',
  assigned_sections: [],
  is_active: true,
})

const getIdField = (role) => {
  if (role === 'instructor') return 'instructor_id'
  if (role === 'admin') return 'admin_id'
  return 'student_id'
}

const getIdLabel = (role) => {
  if (role === 'instructor') return 'Instructor ID'
  if (role === 'admin') return 'Admin ID'
  return 'Student ID'
}

export default function AddUserModal({ isOpen, onClose, onUnauthorized, onSaved, userId, initialRole = 'student' }) {
  const [saving, setSaving] = useState(false)
  const [sections, setSections] = useState([])
  const [loadingSections, setLoadingSections] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [loadingUser, setLoadingUser] = useState(false)
  const [initialForm, setInitialForm] = useState(getBlankForm())

  const [form, setForm] = useState(getBlankForm())

  useEffect(() => {
    if (!isOpen) return

    setErrors({})
    setFormError('')
    setSaving(false)
    setForm(getBlankForm())
    setInitialForm(getBlankForm())
    fetchSections()

    if (userId) {
      fetchUser(userId)
    }
  }, [isOpen, userId])

  useEffect(() => {
    if (!isOpen || userId) return
    setForm((current) => ({ ...current, role: initialRole || 'student' }))
  }, [initialRole, isOpen, userId])

  const fetchUser = async (id) => {
    setLoadingUser(true)
    try {
      const res = await api.get(`/users/${id}/`)
      const data = res.data
      const loadedForm = {
        student_id: data.student_id || '',
        instructor_id: data.instructor_id || '',
        admin_id: data.admin_id || '',
        username: data.username || '',
        email: data.email || '',
        password: '',
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        role: data.role || 'student',
        section: data.section || '' ,
        assigned_sections: Array.isArray(data.assigned_sections)
          ? data.assigned_sections.map((section) => section?.section_id || section?.id || section).filter(Boolean)
          : [],
        is_active: typeof data.is_active === 'boolean' ? data.is_active : true,
      }
      setForm(loadedForm)
      setInitialForm(loadedForm)
    } catch (e) {
      if (e.response?.status === 401) {
        onUnauthorized && onUnauthorized()
      } else {
        console.error('Failed to load user', e)
      }
    } finally {
      setLoadingUser(false)
    }
  }

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

  const handleChange = (key) => (e) => {
    const value = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((errs) => ({ ...errs, [key]: undefined }))
    setFormError('')
  }

  const handleRoleChange = (e) => {
    const role = e.target.value
    setForm((current) => ({
      ...current,
      role,
      section: '',
      assigned_sections: [],
    }))
    setErrors((current) => ({ ...current, role: undefined, section: undefined, assigned_sections: undefined }))
    setFormError('')
  }

  const toggleAssignedSection = (sectionId) => {
    setForm((current) => {
      const selected = current.assigned_sections || []
      const next = selected.includes(sectionId)
        ? selected.filter((id) => id !== sectionId)
        : [...selected, sectionId]
      return { ...current, assigned_sections: next }
    })
    setErrors((current) => ({ ...current, assigned_sections: undefined }))
    setFormError('')
  }

  const handleSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault()
    setSaving(true)
    setErrors({})
    setFormError('')

    let payload = {}

    if (userId) {
      const fields = ['student_id', 'instructor_id', 'username', 'email', 'first_name', 'last_name', 'role', 'section', 'assigned_sections', 'is_active']
      fields.forEach((field) => {
        const value = field === 'section' ? (form.section || null) : field === 'assigned_sections' ? (form.assigned_sections || []) : form[field]
        const initialValue = field === 'section' ? (initialForm.section || null) : field === 'assigned_sections' ? (initialForm.assigned_sections || []) : initialForm[field]
        const changed = field === 'assigned_sections'
          ? JSON.stringify(value) !== JSON.stringify(initialValue)
          : value !== initialValue
        if (changed) {
          payload[field] = value
        }
      })

      if (form.password) {
        payload.password = form.password
      }
    } else {
      payload = {
        student_id: form.student_id || null,
        instructor_id: form.instructor_id || null,
        username: form.username,
        email: form.email,
        password: form.password,
        first_name: form.first_name,
        last_name: form.last_name,
        role: form.role,
        section: form.section || null,
        assigned_sections: form.assigned_sections || [],
        is_active: !!form.is_active,
      }
    }

    // TODO: Backend Update Required - Make 'assigned_sections' writable in UserSerializer before deploying.

    try {
      if (userId) {
        if (Object.keys(payload).length === 0) {
          onSaved && onSaved({ ...form, id: userId })
          return
        }

        const res = await api.patch(`/users/${userId}/`, payload)
        onSaved && onSaved(res.data)
      } else {
        const res = await api.post('/users/', payload)
        onSaved && onSaved(res.data)
      }
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
        setFormError('Failed to save user. Please try again.')
        console.error('Failed to save user', err)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const title = userId ? 'Edit User' : 'Add New User'
  const submitLabel = userId ? 'Save Changes' : 'Save User'
  const helperText = userId ? 'Update the existing account details.' : 'Create a new system account.'

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

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">First Name</label>
            <input value={form.first_name} onChange={handleChange('first_name')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
            {errors.first_name && <p className="mt-1 text-xs text-red-600">{String(errors.first_name)}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Last Name</label>
            <input value={form.last_name} onChange={handleChange('last_name')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
            {errors.last_name && <p className="mt-1 text-xs text-red-600">{String(errors.last_name)}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
            <input type="email" value={form.email} onChange={handleChange('email')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
            {errors.email && <p className="mt-1 text-xs text-red-600">{String(errors.email)}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Username</label>
            <input value={form.username} onChange={handleChange('username')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
            {errors.username && <p className="mt-1 text-xs text-red-600">{String(errors.username)}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{getIdLabel(form.role)}</label>
            <input value={form[getIdField(form.role)] || ''} onChange={handleChange(getIdField(form.role))} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
            {errors[getIdField(form.role)] && <p className="mt-1 text-xs text-red-600">{String(errors[getIdField(form.role)])}</p>}
          </div>
          {!userId && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
              <input type="password" value={form.password} onChange={handleChange('password')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.password && <p className="mt-1 text-xs text-red-600">{String(errors.password)}</p>}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
            <select value={form.role} onChange={handleRoleChange} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
              <option value="admin">admin</option>
              <option value="instructor">instructor</option>
              <option value="student">student</option>
            </select>
            {errors.role && <p className="mt-1 text-xs text-red-600">{String(errors.role)}</p>}
          </div>
          {form.role === 'student' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Section</label>
              <select value={form.section || ''} onChange={handleChange('section')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">(none)</option>
                {loadingSections ? <option>Loading...</option> : sections.map((s) => (
                  <option key={s.id} value={s.id}>{s.section_name || s.name || s.title || `Section ${s.id}`}</option>
                ))}
              </select>
              {errors.section && <p className="mt-1 text-xs text-red-600">{String(errors.section)}</p>}
            </div>
          )}
          {form.role === 'instructor' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Sections</label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2">
                {loadingSections ? <p className="px-2 py-2 text-sm text-slate-500">Loading sections...</p> : sections.map((s) => {
                  const selected = (form.assigned_sections || []).includes(s.id)
                  return (
                    <label key={s.id} className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-slate-700 hover:bg-slate-50">
                      <input type="checkbox" checked={selected} onChange={() => toggleAssignedSection(s.id)} className="h-4 w-4" />
                      {s.section_name || s.name || s.title || `Section ${s.id}`}
                    </label>
                  )
                })}
              </div>
              {errors.assigned_sections && <p className="mt-1 text-xs text-red-600">{String(errors.assigned_sections)}</p>}
            </div>
          )}

          <div className="md:col-span-2 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={handleChange('is_active')} className="h-4 w-4" />
              <span className="text-sm text-slate-700">Active</span>
            </label>
            {errors.non_field_errors && <p className="text-xs text-red-600">{String(errors.non_field_errors)}</p>}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={saving || loadingUser} className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
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
