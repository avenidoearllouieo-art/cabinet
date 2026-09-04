import { useCallback, useEffect, useState } from 'react'
import { BookOpen, UserRound } from 'lucide-react'
import api from '../../services/api.js'
import { controlClass } from '../forms/formStyles.js'
import { FormActions, FormDialog, FormField, FormSection, InlineFeedback } from '../forms/FormPrimitives.jsx'

const blank = () => ({ section_code: '', section_name: '', program: '', year_level: '', instructor: '', status: 'Active' })

export default function SectionFormWorkflow({ isOpen, sectionId, section, onClose, onUnauthorized, onSaved, mode = 'create' }) {
  const resolvedId = section?.id ?? sectionId
  const editing = mode === 'edit'
  const [form, setForm] = useState(blank())
  const [initialForm, setInitialForm] = useState(blank())
  const [instructors, setInstructors] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')

  const loadForm = useCallback(async () => {
    setLoading(true)
    try {
      const requests = [api.get('/users/?role=instructor')]
      if (editing && resolvedId) requests.push(api.get(`/sections/${resolvedId}/`))
      const [instructorsResponse, sectionResponse] = await Promise.all(requests)
      setInstructors(Array.isArray(instructorsResponse.data) ? instructorsResponse.data : instructorsResponse.data.results || [])
      if (sectionResponse) {
        const data = sectionResponse.data || {}
        const loaded = { section_code: data.section_code || '', section_name: data.section_name || '', program: data.program || '', year_level: data.year_level || '', instructor: data.instructor || '', status: data.status || 'Active' }
        setForm(loaded)
        setInitialForm(loaded)
      }
    } catch (error) {
      if (error.response?.status === 401) onUnauthorized?.()
      else setFormError('The section form could not be loaded. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [editing, resolvedId, onUnauthorized])

  useEffect(() => {
    if (!isOpen) return
    const timeoutId = window.setTimeout(() => {
      const clean = blank()
      setForm(clean)
      setInitialForm(clean)
      setErrors({})
      setFormError('')
      loadForm()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, loadForm])

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const required = ['section_code', 'section_name', 'program', 'year_level']
    const nextErrors = Object.fromEntries(required.filter((field) => !form[field]).map((field) => [field, 'This field is required.']))
    if (Object.keys(nextErrors).length) return setErrors(nextErrors)
    if (editing && !resolvedId) return setFormError('Missing section id.')
    setSaving(true)
    setErrors({})
    setFormError('')
    const values = { ...form, instructor: form.instructor || null }
    const payload = editing ? Object.fromEntries(Object.entries(values).filter(([field, value]) => value !== (field === 'instructor' ? initialForm.instructor || null : initialForm[field]))) : values
    try {
      let response
      if (editing) {
        try { response = await api.patch(`/sections/${resolvedId}/`, payload) }
        catch (error) { if (error.response?.status === 405) response = await api.put(`/sections/${resolvedId}/`, values); else throw error }
      } else response = await api.post('/sections/', values)
      onSaved?.(response.data)
      onClose?.()
    } catch (error) {
      if (error.response?.status === 401) return onUnauthorized?.()
      const data = error.response?.data
      if (data && typeof data === 'object') { setErrors(data); setFormError(data.detail || 'Review the highlighted fields.') }
      else setFormError(`Failed to ${editing ? 'update' : 'create'} section. Please try again.`)
    } finally { setSaving(false) }
  }

  return (
    <FormDialog isOpen={isOpen && (!editing || Boolean(resolvedId))} title={editing ? 'Edit Section' : 'Add Section'} description={editing ? 'Update academic and instructor assignments.' : 'Create a new academic section.'} onClose={onClose} onSubmit={handleSubmit} dirty={JSON.stringify(form) !== JSON.stringify(initialForm)} busy={saving} maxWidth="max-w-2xl" zIndex="z-[99999]" actions={<FormActions onCancel={onClose} isLastStep submitLabel={editing ? 'Save changes' : 'Create section'} busy={saving} disabled={loading} dirty={JSON.stringify(form) !== JSON.stringify(initialForm)} />}>
      <div className="space-y-4"><InlineFeedback>{formError}</InlineFeedback>{loading ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading section…</div> : <>
        <FormSection icon={BookOpen} title="Section details" description="Use the official code and academic grouping."><div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <FormField label="Section code" required error={errors.section_code}>{({ id, describedBy, invalid }) => <input id={id} value={form.section_code} onChange={update('section_code')} placeholder="e.g., CS-101" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
          <FormField label="Section name" required error={errors.section_name}>{({ id, describedBy, invalid }) => <input id={id} value={form.section_name} onChange={update('section_name')} placeholder="e.g., A" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
          <FormField label="Program" required error={errors.program}>{({ id, describedBy, invalid }) => <select id={id} value={form.program} onChange={update('program')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)}><option value="">Select program</option><option value="BSIT">BSIT</option><option value="BSCS">BSCS</option><option value="BSIS">BSIS</option><option value="Other">Other</option></select>}</FormField>
          <FormField label="Year level" required error={errors.year_level}>{({ id, describedBy, invalid }) => <select id={id} value={form.year_level} onChange={update('year_level')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)}><option value="">Select year level</option><option value="1st Year">1st Year</option><option value="2nd Year">2nd Year</option><option value="3rd Year">3rd Year</option><option value="4th Year">4th Year</option></select>}</FormField>
        </div></FormSection>
        <FormSection icon={UserRound} title="Ownership and status" description="Assign an instructor now or leave it unassigned."><div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <FormField label="Instructor" optional error={errors.instructor}>{({ id, describedBy, invalid }) => <select id={id} value={form.instructor} onChange={update('instructor')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)}><option value="">Unassigned</option>{instructors.map((instructor) => <option key={instructor.id} value={instructor.id}>{`${instructor.first_name || ''} ${instructor.last_name || ''}`.trim() || instructor.username}</option>)}</select>}</FormField>
          <FormField label="Status" required error={errors.status}>{({ id, describedBy, invalid }) => <select id={id} value={form.status} onChange={update('status')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select>}</FormField>
        </div></FormSection>
      </>}</div>
    </FormDialog>
  )
}
