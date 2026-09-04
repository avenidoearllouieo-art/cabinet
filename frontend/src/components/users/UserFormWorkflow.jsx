import { useCallback, useEffect, useMemo, useState } from 'react'
import { Contact, CreditCard, GraduationCap, Presentation, ShieldCheck, UserRound } from 'lucide-react'
import api from '../../services/api.js'
import {
  FormActions,
  FormDialog,
  FormField,
  FormSection,
  FormStepper,
  InlineFeedback,
  PasswordField,
} from '../forms/FormPrimitives.jsx'
import { controlClass } from '../forms/formStyles.js'

const steps = ['Personal information', 'Role & academics', 'Account & NFC access', 'Review']
const roles = [
  { value: 'student', label: 'Student', description: 'Learner assigned to one section', icon: GraduationCap },
  { value: 'instructor', label: 'Instructor', description: 'Teaching staff with section access', icon: Presentation },
  { value: 'admin', label: 'Administrator', description: 'Full TapTrack administration', icon: ShieldCheck },
]
const blankForm = () => ({ student_id: '', instructor_id: '', admin_id: '', username: '', email: '', password: '', first_name: '', last_name: '', role: 'student', section: '', assigned_sections: [], nfc_uid: '', is_active: true })
const sectionName = (section) => section?.section_name || section?.name || section?.title || `Section ${section?.id ?? ''}`
const sectionId = (section) => section?.id ?? section?.section_id
const snapshot = (form) => JSON.stringify(form)

export default function UserFormWorkflow({ isOpen, userId, user, initialRole = 'student', onClose, onUnauthorized, onSaved, onDeleted, mode = 'create' }) {
  const resolvedId = user?.id ?? userId
  const editing = mode === 'edit'
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(blankForm())
  const [initialForm, setInitialForm] = useState(blankForm())
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingSections, setLoadingSections] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const loadSections = useCallback(async () => {
    setLoadingSections(true)
    try {
      const response = await api.get('/sections/')
      setSections(Array.isArray(response.data) ? response.data : response.data.results || [])
    } catch (error) {
      if (error.response?.status === 401) onUnauthorized?.()
      else setFormError('Sections could not be loaded. Reopen the form to retry.')
    } finally {
      setLoadingSections(false)
    }
  }, [onUnauthorized])

  const loadUser = useCallback(async (id) => {
    setLoading(true)
    try {
      const response = await api.get(`/users/${id}/`)
      const data = response.data || {}
      const loaded = {
        student_id: data.student_id || '', instructor_id: data.instructor_id || '', admin_id: data.role === 'admin' ? data.username || '' : '',
        username: data.username || '', email: data.email || '', password: '', first_name: data.first_name || '', last_name: data.last_name || '',
        role: data.role || 'student', section: sectionId(data.section) ?? data.section ?? '',
        assigned_sections: Array.isArray(data.assigned_sections) ? data.assigned_sections.map((section) => sectionId(section) ?? section).filter(Boolean) : [],
        nfc_uid: data.nfc_uid || '', is_active: typeof data.is_active === 'boolean' ? data.is_active : true,
      }
      setForm(loaded)
      setInitialForm(loaded)
    } catch (error) {
      if (error.response?.status === 401) onUnauthorized?.()
      else setFormError('The user could not be loaded. Close the form and try again.')
    } finally {
      setLoading(false)
    }
  }, [onUnauthorized])

  useEffect(() => {
    if (!isOpen) return
    const timeoutId = window.setTimeout(() => {
      const clean = { ...blankForm(), role: initialRole || 'student' }
      setStep(0)
      setForm(clean)
      setInitialForm(clean)
      setErrors({})
      setFormError('')
      setSuccessMessage('')
      setDeleteOpen(false)
      loadSections()
      if (editing && resolvedId) loadUser(resolvedId)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, editing, resolvedId, initialRole, loadSections, loadUser])

  const update = (field) => (event) => {
    const value = event?.target ? (event.target.type === 'checkbox' ? event.target.checked : event.target.value) : event
    setForm((current) => {
      if (current.role === 'admin' && field === 'admin_id') return { ...current, admin_id: value, username: value }
      if (current.role === 'admin' && field === 'username') return { ...current, username: value, admin_id: value }
      return { ...current, [field]: value }
    })
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  const selectRole = (role) => {
    setForm((current) => ({ ...current, role, section: '', assigned_sections: [], admin_id: role === 'admin' ? current.username : current.admin_id }))
    setErrors((current) => ({ ...current, role: undefined, section: undefined, assigned_sections: undefined }))
  }

  const toggleSection = (id) => {
    setForm((current) => ({ ...current, assigned_sections: current.assigned_sections.includes(id) ? current.assigned_sections.filter((value) => value !== id) : [...current.assigned_sections, id] }))
    setErrors((current) => ({ ...current, assigned_sections: undefined }))
  }

  const validateStep = (currentStep) => {
    const nextErrors = {}
    if (currentStep === 0) {
      if (!form.first_name.trim()) nextErrors.first_name = 'Enter the user’s first name.'
      if (!form.last_name.trim()) nextErrors.last_name = 'Enter the user’s last name.'
      if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = 'Enter a valid email address.'
    }
    if (currentStep === 1) {
      if (form.role === 'student' && !form.student_id.trim()) nextErrors.student_id = 'Enter a student ID.'
      if (form.role === 'instructor' && !form.instructor_id.trim()) nextErrors.instructor_id = 'Enter an instructor ID.'
      if (form.role === 'student' && !form.section) nextErrors.section = 'Choose the student’s section.'
    }
    if (currentStep === 2) {
      if (!form.username.trim()) nextErrors.username = 'Enter a username.'
      if (!editing && !form.password) nextErrors.password = 'Create a password.'
      if (form.password && form.password.length < 8) nextErrors.password = 'Use at least 8 characters.'
    }
    setErrors((current) => ({ ...current, ...nextErrors }))
    return Object.keys(nextErrors).length === 0
  }

  const goNext = () => {
    if (validateStep(step)) setStep((current) => Math.min(current + 1, steps.length - 1))
  }

  const buildPayload = () => {
    const values = {
      student_id: form.role === 'student' ? form.student_id || null : null,
      instructor_id: form.role === 'instructor' ? form.instructor_id || null : null,
      username: form.username, email: form.email, first_name: form.first_name, last_name: form.last_name,
      role: form.role, section: form.role === 'student' ? form.section || null : null,
      assigned_sections: form.role === 'instructor' ? form.assigned_sections : [],
      nfc_uid: form.nfc_uid || null, is_active: Boolean(form.is_active),
    }
    if (form.password) values.password = form.password
    if (!editing) return values
    const changed = {}
    Object.entries(values).forEach(([field, value]) => {
      const initialValue = field === 'student_id' ? (initialForm.role === 'student' ? initialForm.student_id || null : null)
        : field === 'instructor_id' ? (initialForm.role === 'instructor' ? initialForm.instructor_id || null : null)
          : field === 'section' ? (initialForm.role === 'student' ? initialForm.section || null : null)
            : field === 'assigned_sections' ? (initialForm.role === 'instructor' ? initialForm.assigned_sections : [])
              : field === 'nfc_uid' ? initialForm.nfc_uid || null : initialForm[field]
      if (Array.isArray(value) ? JSON.stringify(value) !== JSON.stringify(initialValue) : value !== initialValue) changed[field] = value
    })
    return changed
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (step !== steps.length - 1) return goNext()
    if (saving) return
    const validationResults = [0, 1, 2].map((stepIndex) => validateStep(stepIndex))
    const firstInvalidStep = validationResults.indexOf(false)
    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep)
      return
    }
    if (editing && !resolvedId) return setFormError('Missing user id.')
    setSaving(true)
    setErrors({})
    setFormError('')
    setSuccessMessage('')
    const payload = buildPayload()
    try {
      const response = editing ? await api.patch(`/users/${resolvedId}/`, payload) : await api.post('/users/', payload)
      onSaved?.(response.data)
      setForm((current) => ({ ...current, password: '' }))
      setInitialForm({ ...form, password: '' })
      setSuccessMessage(editing ? 'User updated successfully.' : 'User created successfully.')
    } catch (error) {
      if (error.response?.status === 401) return onUnauthorized?.()
      const data = error.response?.data
      if (data && typeof data === 'object') {
        setErrors(data)
        setFormError(typeof data.detail === 'string' ? data.detail : 'Some fields need your attention.')
        const fieldToStep = { first_name: 0, last_name: 0, email: 0, student_id: 1, instructor_id: 1, section: 1, assigned_sections: 1, role: 1, username: 2, password: 2, nfc_uid: 2 }
        const firstField = Object.keys(data).find((field) => fieldToStep[field] !== undefined)
        if (firstField) setStep(fieldToStep[firstField])
      } else setFormError(`Failed to ${editing ? 'update' : 'create'} user. Please try again.`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!resolvedId || deleteSaving) return
    setDeleteSaving(true)
    setDeleteError('')
    try {
      await api.delete(`/users/${resolvedId}/`)
      onDeleted?.(resolvedId)
      setDeleteOpen(false)
      onClose?.()
    } catch (error) {
      if (error.response?.status === 401) return onUnauthorized?.()
      setDeleteError(error.response?.data?.detail || 'Failed to delete this user.')
    } finally {
      setDeleteSaving(false)
    }
  }

  const selectedSections = useMemo(() => sections.filter((section) => form.assigned_sections.includes(sectionId(section))), [sections, form.assigned_sections])
  const idLabel = form.role === 'student' ? 'Student ID' : form.role === 'instructor' ? 'Instructor ID' : 'Admin ID'
  const idValue = form.role === 'student' ? form.student_id : form.role === 'instructor' ? form.instructor_id : form.admin_id
  const passwordScore = !form.password ? 0 : [form.password.length >= 8, /[A-Z]/.test(form.password), /[a-z]/.test(form.password), /\d/.test(form.password), /[^A-Za-z0-9]/.test(form.password)].filter(Boolean).length
  const dirty = snapshot(form) !== snapshot(initialForm)

  return <>
    <FormDialog
      isOpen={isOpen && (!editing || Boolean(resolvedId))}
      title={editing ? 'Edit User' : 'Add New User'}
      description={editing ? 'Update identity, access, and account settings.' : 'Create a TapTrack account in four clear steps.'}
      onClose={onClose} onSubmit={handleSubmit} dirty={dirty} busy={saving}
      stepper={<FormStepper steps={steps} currentStep={step} />}
      actions={<FormActions onCancel={onClose} onBack={step > 0 ? () => setStep((current) => current - 1) : undefined} onNext={goNext} isLastStep={step === steps.length - 1} submitLabel={editing ? 'Update user' : 'Create user'} busy={saving} disabled={loading || loadingSections} dirty={dirty} destructiveAction={editing ? <button type="button" onClick={() => setDeleteOpen(true)} className="min-h-11 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-600">Delete user</button> : undefined} />}
      zIndex={editing ? 'z-[99999]' : 'z-[9999]'}
    >
      <div className="space-y-4">
        <InlineFeedback>{formError}</InlineFeedback><InlineFeedback type="success">{successMessage}</InlineFeedback>
        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading user…</div> : step === 0 ? (
          <FormSection icon={Contact} title="Personal information" description="Use the person’s official details for clear records.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField label="First name" required error={errors.first_name}>{({ id, describedBy, invalid }) => <input id={id} value={form.first_name} onChange={update('first_name')} autoComplete="given-name" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <FormField label="Last name" required error={errors.last_name}>{({ id, describedBy, invalid }) => <input id={id} value={form.last_name} onChange={update('last_name')} autoComplete="family-name" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <FormField label="Email address" optional error={errors.email} className="md:col-span-2">{({ id, describedBy, invalid }) => <input id={id} type="email" value={form.email} onChange={update('email')} autoComplete="email" placeholder="name@example.com" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
            </div>
          </FormSection>
        ) : step === 1 ? (
          <FormSection icon={UserRound} title="Role and academic information" description="Choose the role first; only relevant fields are shown.">
            <fieldset><legend className="mb-2 text-sm font-semibold text-slate-700">Role <span className="text-rose-600">*</span></legend><div className="grid grid-cols-1 gap-3 md:grid-cols-3">{roles.map(({ value, label, description, icon: Icon }) => { const selected = form.role === value; return <button key={value} type="button" onClick={() => selectRole(value)} aria-pressed={selected} className={`min-h-24 rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-900 ${selected ? 'border-[#F5B700] bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}><Icon className={`h-5 w-5 ${selected ? 'text-blue-900' : 'text-slate-500'}`} /><span className="mt-2 block text-sm font-bold text-[#0B1F3A]">{label}</span><span className="mt-1 block text-xs text-slate-500">{description}</span></button> })}</div></fieldset>
            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField label={idLabel} required={form.role !== 'admin'} optional={form.role === 'admin'} error={errors[form.role === 'student' ? 'student_id' : form.role === 'instructor' ? 'instructor_id' : 'admin_id']} helper={form.role === 'admin' ? 'Administrator IDs are saved as the account username by the current API.' : undefined}>{({ id, describedBy, invalid }) => <input id={id} value={idValue} onChange={update(form.role === 'student' ? 'student_id' : form.role === 'instructor' ? 'instructor_id' : 'admin_id')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              {form.role === 'student' && <FormField label="Section" required error={errors.section}>{({ id, describedBy, invalid }) => <select id={id} value={form.section} onChange={update('section')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)}><option value="">Select a section</option>{sections.map((section) => <option key={sectionId(section)} value={sectionId(section)}>{sectionName(section)}</option>)}</select>}</FormField>}
              {form.role === 'instructor' && <FormField label="Assigned sections" optional error={errors.assigned_sections} className="md:col-span-2">{({ describedBy, invalid }) => <div className={`max-h-52 overflow-y-auto rounded-xl border bg-white p-2 ${invalid ? 'border-rose-400' : 'border-slate-300'}`} aria-describedby={describedBy}>{loadingSections ? <p className="p-3 text-sm text-slate-500">Loading sections…</p> : sections.map((section) => { const id = sectionId(section); return <label key={id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={form.assigned_sections.includes(id)} onChange={() => toggleSection(id)} className="h-5 w-5 rounded border-slate-300 text-blue-900 focus:ring-blue-900" />{sectionName(section)}</label> })}</div>}</FormField>}
            </div>
            {selectedSections.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{selectedSections.map((section) => <button key={sectionId(section)} type="button" onClick={() => toggleSection(sectionId(section))} className="min-h-9 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-900">{sectionName(section)} ×</button>)}</div>}
          </FormSection>
        ) : step === 2 ? (
          <FormSection icon={CreditCard} title="Account and NFC access" description="Set login credentials and hardware access status.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField label="Username" required error={errors.username}>{({ id, describedBy, invalid }) => <input id={id} value={form.username} onChange={update('username')} autoComplete="username" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <PasswordField label={editing ? 'New password' : 'Password'} required={!editing} value={form.password} onChange={update('password')} error={errors.password} helper={editing ? 'Optional. Leave blank to keep the current password.' : 'Use 8+ characters with a mix of letters, numbers, and symbols.'} />
              {form.password && <div className="md:col-span-2" aria-label={`Password strength ${passwordScore} out of 5`}><div className="flex gap-1">{[1, 2, 3, 4, 5].map((value) => <span key={value} className={`h-1.5 flex-1 rounded-full ${value <= passwordScore ? passwordScore < 3 ? 'bg-rose-500' : passwordScore < 5 ? 'bg-amber-500' : 'bg-emerald-500' : 'bg-slate-200'}`} />)}</div><p className="mt-1 text-xs text-slate-500">Strength: {passwordScore < 3 ? 'Weak' : passwordScore < 5 ? 'Good' : 'Strong'}</p></div>}
              <FormField label="NFC UID" optional error={errors.nfc_uid} helper="Enter the UID printed or scanned from the user’s NFC credential.">{({ id, describedBy, invalid }) => <input id={id} value={form.nfc_uid} onChange={update('nfc_uid')} placeholder="e.g., 04A1B2C3D4" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <div className="flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-4"><label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.is_active} onChange={update('is_active')} className="h-5 w-5 rounded border-slate-300 text-blue-900 focus:ring-blue-900" />Account is active</label></div>
            </div>
          </FormSection>
        ) : (
          <FormSection icon={ShieldCheck} title="Review and create" description="Confirm identity, role, and access before saving.">
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <ReviewItem label="Name" value={`${form.first_name} ${form.last_name}`.trim() || 'Not provided'} /><ReviewItem label="Email" value={form.email || 'Not provided'} />
              <ReviewItem label="Role" value={roles.find((role) => role.value === form.role)?.label} /><ReviewItem label={idLabel} value={idValue || (form.role === 'admin' ? 'Uses username' : 'Not provided')} />
              <ReviewItem label="Username" value={form.username || 'Not provided'} /><ReviewItem label="NFC access" value={form.nfc_uid || 'Not assigned'} />
              <ReviewItem label="Sections" value={form.role === 'student' ? sectionName(sections.find((section) => String(sectionId(section)) === String(form.section))) : form.role === 'instructor' ? selectedSections.map(sectionName).join(', ') || 'None assigned' : 'Not applicable'} /><ReviewItem label="Account status" value={form.is_active ? 'Active' : 'Inactive'} />
            </dl>
            {form.role === 'instructor' && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Instructor section choices are shown for review. The current User API exposes assigned sections as read-only, so deployment still requires the planned serializer update for these assignments to persist.</p>}
          </FormSection>
        )}
      </div>
    </FormDialog>
    <FormDialog isOpen={deleteOpen} title="Delete user" description="This permanently removes the account and cannot be undone." onClose={() => setDeleteOpen(false)} onSubmit={(event) => { event.preventDefault(); handleDelete() }} busy={deleteSaving} zIndex="z-[100000]" maxWidth="max-w-lg" actions={<div className="flex justify-end gap-3"><button type="button" onClick={() => setDeleteOpen(false)} disabled={deleteSaving} className="min-h-11 rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={deleteSaving} className="min-h-11 rounded-xl bg-rose-600 px-5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">{deleteSaving ? 'Deleting…' : 'Delete user'}</button></div>}><InlineFeedback>{deleteError}</InlineFeedback><p className="text-sm leading-6 text-slate-700">Delete <strong>{form.first_name || form.username || 'this user'}</strong>? Their account access will stop immediately.</p></FormDialog>
  </>
}

function ReviewItem({ label, value }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-[#0B1F3A]">{value}</dd></div>
}
