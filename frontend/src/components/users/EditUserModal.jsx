import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../services/api.js'

export default function EditUserModal({ isOpen, userId, user, onClose, onUnauthorized, onSaved, onDeleted }) {
  const resolvedUserId = user?.id ?? userId
  console.log('EditUserModal render', { isOpen, userId, user, resolvedUserId })
  window.__editDebug = { ...window.__editDebug, modalRender: { isOpen, userId, user, resolvedUserId } }
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [sections, setSections] = useState([])
  const [loadingSections, setLoadingSections] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')

  const blank = {
    student_id: '',
    username: '',
    email: '',
    first_name: '',
    last_name: '',
    role: 'student',
    section: '',
    is_active: true,
  }

  const [form, setForm] = useState(blank)
  const [initialForm, setInitialForm] = useState(blank)

  useEffect(() => {
    if (!isOpen) return
    setErrors({})
    setFormError('')
    setForm(blank)
    setInitialForm(blank)
    fetchSections()
    if (resolvedUserId) {
      console.log('EditUserModal fetching user', resolvedUserId)
      fetchUser(resolvedUserId)
    }
  }, [isOpen, resolvedUserId])

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

  const fetchUser = async (id) => {
    setLoading(true)
    try {
      const res = await api.get(`/users/${id}/`)
      const data = res.data || {}
      const loaded = {
        student_id: data.student_id || '',
        username: data.username || '',
        email: data.email || '',
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        role: data.role || 'student',
        section: data.section || '',
        is_active: typeof data.is_active === 'boolean' ? data.is_active : true,
      }
      setForm(loaded)
      setInitialForm(loaded)
    } catch (e) {
      if (e.response?.status === 401) {
        onUnauthorized && onUnauthorized()
      } else {
        console.error('Failed to load user', e)
        setFormError('Failed to load user.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (key) => (e) => {
    const value = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((errs) => ({ ...errs, [key]: undefined }))
    setFormError('')
  }

  const openDeleteConfirm = () => {
    setDeleteError('')
    setIsDeleteConfirmOpen(true)
  }

  const closeDeleteConfirm = () => {
    setDeleteError('')
    setIsDeleteConfirmOpen(false)
  }

  const handleDelete = async () => {
    if (!resolvedUserId) {
      setDeleteError('Missing user id.')
      return
    }

    setDeleteSaving(true)
    setDeleteError('')

    try {
      await api.delete(`/users/${resolvedUserId}/`)
      onDeleted && onDeleted(resolvedUserId)
      closeDeleteConfirm()
      onClose && onClose()
    } catch (err) {
      const status = err.response?.status
      if (status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }
      if (status === 403) {
        setDeleteError(err.response?.data?.detail || 'Forbidden. You do not have permission to delete this user.')
      } else if (status === 404) {
        setDeleteError(err.response?.data?.detail || 'User not found.')
      } else {
        setDeleteError(err.response?.data?.detail || 'Failed to delete user.')
      }
    } finally {
      setDeleteSaving(false)
    }
  }

  const handleSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault()
    setSaving(true)
    setErrors({})
    setFormError('')

    if (!resolvedUserId) {
      setFormError('Missing user id')
      setSaving(false)
      return
    }

    const payload = {}
    const fields = ['student_id', 'username', 'email', 'first_name', 'last_name', 'role', 'section', 'is_active']
    fields.forEach((field) => {
      const value = field === 'section' ? (form.section || null) : form[field]
      const initial = field === 'section' ? (initialForm.section || null) : initialForm[field]
      if (value !== initial) payload[field] = value
    })

    if (Object.keys(payload).length === 0) {
      // nothing changed
      onSaved && onSaved({ ...form, id: resolvedUserId })
      onClose && onClose()
      setSaving(false)
      return
    }

    try {
      const res = await api.patch(`/users/${resolvedUserId}/`, payload)
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
        console.error('Failed to save user', err)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !resolvedUserId) {
    console.log('EditUserModal returning null', { isOpen, resolvedUserId, user })
    window.__editDebug = { ...window.__editDebug, modalReturn: { isOpen, resolvedUserId, user } }
    return null
  }

  const title = 'Edit User'
  const submitLabel = 'Save Changes'

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">{title}</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Update the existing account details.</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl font-bold text-[#475569] transition hover:text-[#0F172A]" aria-label="Close modal">×</button>
        </div>

        {formError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
        )}

        {loading ? (
          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Student ID</label>
              <input value={form.student_id} onChange={handleChange('student_id')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.student_id && <p className="mt-1 text-xs text-red-600">{String(errors.student_id)}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Username</label>
              <input value={form.username} onChange={handleChange('username')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.username && <p className="mt-1 text-xs text-red-600">{String(errors.username)}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input type="email" value={form.email} onChange={handleChange('email')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              {errors.email && <p className="mt-1 text-xs text-red-600">{String(errors.email)}</p>}
            </div>

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
              <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
              <select value={form.role} onChange={handleChange('role')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
                <option value="admin">admin</option>
                <option value="instructor">instructor</option>
                <option value="student">student</option>
              </select>
              {errors.role && <p className="mt-1 text-xs text-red-600">{String(errors.role)}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Section</label>
              <select value={form.section || ''} onChange={handleChange('section')} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">(none)</option>
                {loadingSections ? <option>Loading...</option> : sections.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || s.title || `Section ${s.id}`}</option>
                ))}
              </select>
              {errors.section && <p className="mt-1 text-xs text-red-600">{String(errors.section)}</p>}
            </div>

            <div className="md:col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={handleChange('is_active')} className="h-4 w-4" />
                <span className="text-sm text-slate-700">Active</span>
              </label>
              {errors.non_field_errors && <p className="text-xs text-red-600">{String(errors.non_field_errors)}</p>}
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openDeleteConfirm}
              disabled={saving || deleteSaving}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Delete User
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} disabled={saving || deleteSaving} className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60">Cancel</button>
            <button type="submit" disabled={saving || loading || deleteSaving} className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {saving && (
                <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
                </svg>
              )}
              {submitLabel}
            </button>
          </div>
        </div>

        {isDeleteConfirmOpen && (
          <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-[520px] rounded-2xl bg-white p-8 shadow-xl">
              <div className="mb-4">
                <h3 className="text-xl font-semibold text-[#0F172A]">Delete User</h3>
                <p className="mt-2 text-sm text-[#6B7280]">Are you sure you want to delete this user? This action cannot be undone.</p>
              </div>
              {deleteError && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {deleteError}
                </div>
              )}
              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDeleteConfirm}
                  disabled={deleteSaving}
                  className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteSaving}
                  className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {deleteSaving && (
                    <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
                    </svg>
                  )}
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>,
    document.body,
  )
}

