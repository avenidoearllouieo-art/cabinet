import { useEffect, useMemo, useRef, useState } from 'react'
import { Contact, CreditCard, GraduationCap, Presentation, ShieldCheck, UserRound } from 'lucide-react'
import api from '../../services/api.js'
import {
  FormActions,
  FormDialog,
  FormField,
  FormSection,
  FormStepper,
  InlineFeedback,
} from '../forms/FormPrimitives.jsx'
import { controlClass } from '../forms/formStyles.js'

const steps = ['Personal information', 'Role & academics', 'ID Card & Registration', 'Review']
const roles = [
  { value: 'student', label: 'Student', description: 'Learner assigned to an academic section.', icon: GraduationCap },
  { value: 'instructor', label: 'Instructor', description: 'Teaching staff with section access.', icon: Presentation },
  { value: 'admin', label: 'Administrator', description: 'Authorized personnel responsible for system management.', icon: ShieldCheck },
]
const blankForm = () => ({ student_id: '', instructor_id: '', administrator_id: '', email: '', first_name: '', last_name: '', role: 'student', section: '', assigned_sections: [], nfc_uid: '', is_active: true })
const sectionName = (section) => section?.section_name || section?.name || section?.title || `Section ${section?.id ?? ''}`
const sectionId = (section) => section?.id ?? section?.section_id
const snapshot = (form) => JSON.stringify(form)

export default function UserFormWorkflow(props) {
  const mode = props.mode || (props.userId ? 'edit' : 'create')
  const resolvedId = props.user?.id ?? props.userId
  const sessionKey = props.isOpen
    ? `${mode}:${resolvedId ?? ''}:${props.initialRole || 'student'}`
    : 'closed'
  return <UserFormWorkflowSession key={sessionKey} {...props} mode={mode} />
}

function UserFormWorkflowSession({ isOpen, userId, user, initialRole = 'student', canProvisionAdministrators = false, onClose, onUnauthorized, onSaved, mode = 'create' }) {
  const resolvedId = user?.id ?? userId
  const editing = mode === 'edit'
  const [step, setStep] = useState(0)
  const initialValues = { ...blankForm(), role: initialRole === 'admin' && !canProvisionAdministrators ? 'student' : initialRole || 'student' }
  const [form, setForm] = useState(initialValues)
  const [initialForm, setInitialForm] = useState(initialValues)
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(editing && Boolean(resolvedId))
  const [loadingSections, setLoadingSections] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const submitInFlightRef = useRef(false)
  const onUnauthorizedRef = useRef(onUnauthorized)

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized
  }, [onUnauthorized])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    let active = true
    api.get('/sections/').then((response) => {
      if (!active) return
      setSections(Array.isArray(response.data) ? response.data : response.data.results || [])
    }).catch((error) => {
      if (!active) return
      if (error.response?.status === 401) onUnauthorizedRef.current?.()
      else setFormError('Sections could not be loaded. Reopen the form to retry.')
    }).finally(() => {
      if (active) setLoadingSections(false)
    })

    if (editing && resolvedId) {
      api.get(`/users/${resolvedId}/`).then((response) => {
        if (!active) return
        const data = response.data || {}
        const loaded = {
          student_id: data.student_id || '', instructor_id: data.instructor_id || '', administrator_id: data.administrator_id || '',
          email: data.email || '', first_name: data.first_name || '', last_name: data.last_name || '',
          role: data.role || 'student', section: sectionId(data.section) ?? data.section ?? '',
          assigned_sections: Array.isArray(data.assigned_sections) ? data.assigned_sections.map((section) => sectionId(section) ?? section).filter(Boolean) : [],
          nfc_uid: data.nfc_uid || '', is_active: typeof data.is_active === 'boolean' ? data.is_active : true,
        }
        setForm(loaded)
        setInitialForm(loaded)
      }).catch((error) => {
        if (!active) return
        if (error.response?.status === 401) onUnauthorizedRef.current?.()
        else setFormError('The user could not be loaded. Close the form and try again.')
      }).finally(() => {
        if (active) setLoading(false)
      })
    }

    return () => { active = false }
  }, [isOpen, editing, resolvedId])

  const update = (field) => (event) => {
    const value = event?.target ? (event.target.type === 'checkbox' ? event.target.checked : event.target.value) : event
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  const selectRole = (role) => {
    setForm((current) => ({ ...current, role, section: '', assigned_sections: [] }))
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
      if (!form.email.trim()) nextErrors.email = 'Enter the email address used for registration verification.'
      else if (!/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = 'Enter a valid email address.'
    }
    if (currentStep === 1) {
      if (form.role === 'student' && !form.student_id.trim()) nextErrors.student_id = 'Enter a student ID.'
      if (form.role === 'instructor' && !form.instructor_id.trim()) nextErrors.instructor_id = 'Enter an instructor ID.'
      if (form.role === 'admin' && !form.administrator_id.trim()) nextErrors.administrator_id = 'Enter an administrator ID.'
      if (form.role === 'student' && !form.section) nextErrors.section = 'Choose the student’s section.'
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
      administrator_id: form.role === 'admin' ? form.administrator_id || null : null,
      email: form.email, first_name: form.first_name, last_name: form.last_name,
      role: form.role, section: form.role === 'student' ? form.section || null : null,
      assigned_sections: form.role === 'instructor' ? form.assigned_sections : [],
      nfc_uid: form.nfc_uid || null, is_active: Boolean(form.is_active),
    }
    if (!editing) return values
    const changed = {}
    Object.entries(values).forEach(([field, value]) => {
      const initialValue = field === 'student_id' ? (initialForm.role === 'student' ? initialForm.student_id || null : null)
        : field === 'instructor_id' ? (initialForm.role === 'instructor' ? initialForm.instructor_id || null : null)
          : field === 'administrator_id' ? (initialForm.role === 'admin' ? initialForm.administrator_id || null : null)
          : field === 'section' ? (initialForm.role === 'student' ? initialForm.section || null : null)
            : field === 'assigned_sections' ? (initialForm.role === 'instructor' ? initialForm.assigned_sections : [])
              : field === 'nfc_uid' ? initialForm.nfc_uid || null : initialForm[field]
      if (Array.isArray(value) ? JSON.stringify(value) !== JSON.stringify(initialValue) : value !== initialValue) changed[field] = value
    })
    return changed
  }

  const submitFinalStep = async () => {
    if (saving || submitInFlightRef.current) return
    submitInFlightRef.current = true
    const validationResults = [0, 1, 2].map((stepIndex) => validateStep(stepIndex))
    const firstInvalidStep = validationResults.indexOf(false)
    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep)
      submitInFlightRef.current = false
      return
    }
    if (editing && !resolvedId) {
      setFormError('Missing user id.')
      submitInFlightRef.current = false
      return
    }
    setSaving(true)
    setErrors({})
    setFormError('')
    setSuccessMessage('')
    const payload = buildPayload()
    try {
      const response = editing ? await api.patch(`/users/${resolvedId}/`, payload) : await api.post('/users/', payload)
      onSaved?.(response.data)
      setSuccessMessage(editing ? 'User updated successfully.' : 'User created successfully.')
    } catch (error) {
      if (error.response?.status === 401) return onUnauthorized?.()
      const data = error.response?.data
      if (data && typeof data === 'object') {
        setErrors(data)
        setFormError(typeof data.detail === 'string' ? data.detail : 'Some fields need your attention.')
        const fieldToStep = { first_name: 0, last_name: 0, email: 0, student_id: 1, instructor_id: 1, administrator_id: 1, section: 1, assigned_sections: 1, role: 1, nfc_uid: 2 }
        const firstField = Object.keys(data).find((field) => fieldToStep[field] !== undefined)
        if (firstField) setStep(fieldToStep[firstField])
      } else setFormError(`Failed to ${editing ? 'update' : 'create'} user. Please try again.`)
    } finally {
      submitInFlightRef.current = false
      setSaving(false)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (step !== steps.length - 1) {
      goNext()
      return
    }
    if (editing) void submitFinalStep()
  }

  const selectedSections = useMemo(() => sections.filter((section) => form.assigned_sections.includes(sectionId(section))), [sections, form.assigned_sections])
  const selectableRoles = roles.filter((role) => role.value !== 'admin' || canProvisionAdministrators)
  const idLabel = form.role === 'student' ? 'Student ID' : form.role === 'instructor' ? 'Instructor ID' : 'Administrator ID'
  const idValue = form.role === 'student' ? form.student_id : form.role === 'instructor' ? form.instructor_id : form.administrator_id
  const dirty = snapshot(form) !== snapshot(initialForm)

  return <>
    <FormDialog
      isOpen={isOpen && (!editing || Boolean(resolvedId))}
      title={editing ? 'Edit User' : 'Add New User'}
      description={editing ? 'Update profile details, role, and NFC access.' : 'Create a pending profile. The user sets up their login during registration.'}
      onClose={onClose} onSubmit={handleSubmit} dirty={dirty} busy={saving}
      stepper={<FormStepper steps={steps} currentStep={step} />}
      actions={<FormActions onCancel={onClose} onBack={step > 0 ? () => setStep((current) => current - 1) : undefined} onNext={goNext} onFinalAction={!editing ? submitFinalStep : undefined} finalButtonType={editing ? 'submit' : 'button'} isLastStep={step === steps.length - 1} submitLabel={editing ? 'Update user' : 'Add User'} busy={saving} busyLabel={editing ? 'Updating…' : 'Creating…'} disabled={loading || (loadingSections && step === 1 && form.role === 'student')} dirty={dirty} />}
    >
      <div className="space-y-4">
        <InlineFeedback>{formError}</InlineFeedback><InlineFeedback type="success">{successMessage}</InlineFeedback>
        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading user…</div> : step === 0 ? (
          <FormSection icon={Contact} title="Personal information" description="Use the person’s official details for clear records.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField label="First name" required error={errors.first_name}>{({ id, describedBy, invalid }) => <input id={id} value={form.first_name} onChange={update('first_name')} autoComplete="given-name" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <FormField label="Last name" required error={errors.last_name}>{({ id, describedBy, invalid }) => <input id={id} value={form.last_name} onChange={update('last_name')} autoComplete="family-name" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <FormField label="Email address" required error={errors.email} className="md:col-span-2">{({ id, describedBy, invalid }) => <input id={id} type="email" value={form.email} onChange={update('email')} autoComplete="email" placeholder="name@example.com" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
            </div>
          </FormSection>
        ) : step === 1 ? (
          <FormSection icon={UserRound} title="Role and academic information" description="Choose the role first; only relevant fields are shown.">
            <fieldset><legend className="mb-2 text-sm font-semibold text-slate-700">Role <span className="text-rose-600">*</span></legend><div className="grid grid-cols-1 gap-3 md:grid-cols-3">{selectableRoles.map(({ value, label, description, icon: Icon }) => { const selected = form.role === value; return <button key={value} type="button" onClick={() => selectRole(value)} aria-pressed={selected} className={`min-h-24 rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-900 ${selected ? 'border-[#F5B700] bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}><Icon className={`h-5 w-5 ${selected ? 'text-blue-900' : 'text-slate-500'}`} /><span className="mt-2 block text-sm font-bold text-[#0B1F3A]">{label}</span><span className="mt-1 block text-xs text-slate-500">{description}</span></button> })}</div></fieldset>
            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField label={idLabel} required error={errors[form.role === 'student' ? 'student_id' : form.role === 'instructor' ? 'instructor_id' : 'administrator_id']}>
                {({ id, describedBy, invalid }) => <input id={id} value={idValue} onChange={update(form.role === 'student' ? 'student_id' : form.role === 'instructor' ? 'instructor_id' : 'administrator_id')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} placeholder={`Enter ${idLabel.toLowerCase()} number`} />}
              </FormField>
              {form.role === 'student' && <FormField label="Section" required error={errors.section}>{({ id, describedBy, invalid }) => <select id={id} value={form.section} onChange={update('section')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)}><option value="">Select a section</option>{sections.map((section) => <option key={sectionId(section)} value={sectionId(section)}>{sectionName(section)}</option>)}</select>}</FormField>}
              {form.role === 'instructor' && <FormField label="Assigned sections" optional error={errors.assigned_sections} className="md:col-span-2">{({ describedBy, invalid }) => <div className={`max-h-52 overflow-y-auto rounded-xl border bg-white p-2 ${invalid ? 'border-rose-400' : 'border-slate-300'}`} aria-describedby={describedBy}>{loadingSections ? <p className="p-3 text-sm text-slate-500">Loading sections…</p> : sections.map((section) => { const id = sectionId(section); return <label key={id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={form.assigned_sections.includes(id)} onChange={() => toggleSection(id)} className="h-5 w-5 rounded border-slate-300 text-blue-900 focus:ring-blue-900" />{sectionName(section)}</label> })}</div>}</FormField>}
            </div>
            {selectedSections.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{selectedSections.map((section) => <button key={sectionId(section)} type="button" onClick={() => toggleSection(sectionId(section))} className="min-h-9 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-900">{sectionName(section)} ×</button>)}</div>}
          </FormSection>
        ) : step === 2 ? (
          <FormSection icon={CreditCard} title="NFC Access & Registration" description="Assign an optional card and set account availability. Users create their own login credentials during registration.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField label="NFC UID" optional error={errors.nfc_uid} helper="Enter the UID printed or scanned from the user’s NFC credential.">{({ id, describedBy, invalid }) => <input id={id} value={form.nfc_uid} onChange={update('nfc_uid')} placeholder="e.g., 04A1B2C3D4" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <div className="flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-4"><label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.is_active} onChange={update('is_active')} className="h-5 w-5 rounded border-slate-300 text-blue-900 focus:ring-blue-900" />Account is active</label></div>
            </div>
          </FormSection>
        ) : (
          <FormSection icon={ShieldCheck} title="Review and create" description="Confirm identity, role, and access before saving.">
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <ReviewItem label="Name" value={`${form.first_name} ${form.last_name}`.trim() || 'Not provided'} /><ReviewItem label="Email" value={form.email || 'Not provided'} />
              <ReviewItem label="Role" value={roles.find((role) => role.value === form.role)?.label} /><ReviewItem label={idLabel} value={idValue || 'Not provided'} />
              <ReviewItem label="NFC access" value={form.nfc_uid || 'Not assigned'} />
              <ReviewItem label="Sections" value={form.role === 'student' ? sectionName(sections.find((section) => String(sectionId(section)) === String(form.section))) : form.role === 'instructor' ? selectedSections.map(sectionName).join(', ') || 'None assigned' : 'Not applicable'} /><ReviewItem label="Registration status" value={!form.is_active ? 'Inactive' : 'Pending Registration'} />
            </dl>
          </FormSection>
        )}
      </div>
    </FormDialog>
  </>
}

function ReviewItem({ label, value }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-[#0B1F3A]">{value}</dd></div>
}
