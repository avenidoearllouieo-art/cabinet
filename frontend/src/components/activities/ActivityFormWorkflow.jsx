import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, CalendarClock, ClipboardCheck, Users } from 'lucide-react'
import api from '../../services/api.js'
import {
  FileUploadArea,
  FormActions,
  FormDialog,
  FormField,
  FormSection,
  FormStepper,
  InlineFeedback,
} from '../forms/FormPrimitives.jsx'
import { controlClass } from '../forms/formStyles.js'

const steps = ['Activity details', 'Assigned sections', 'Deadline & files', 'Review & publish']
const blankForm = () => ({ title: '', description: '', instructions: '', sections: [], due_date: '', due_time: '', max_score: '100', cabinet_station: '', status: 'Published', files: [] })
const getSectionId = (section) => section?.id ?? section?.section_id ?? section?.section_code
const getSectionName = (section) => section?.section_name || section?.name || section?.title || section?.section_code || 'Unnamed section'
const snapshot = (form) => JSON.stringify({ ...form, files: form.files.map((file) => `${file.name}:${file.size}`) })

function readAssignedSections(data) {
  if (Array.isArray(data.assigned_sections) && data.assigned_sections.length) {
    return data.assigned_sections.map((section) => getSectionId(section) ?? section).filter((value) => value !== undefined && value !== null)
  }
  return data.section !== undefined && data.section !== null && data.section !== '' ? [getSectionId(data.section) ?? data.section] : []
}

export default function ActivityFormWorkflow({ isOpen, activityId, activity, onClose, onUnauthorized, onSaved, mode = 'create' }) {
  const resolvedId = activity?.id ?? activityId
  const editing = mode === 'edit'
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingSections, setLoadingSections] = useState(false)
  const [sections, setSections] = useState([])
  const [form, setForm] = useState(blankForm())
  const [initialSnapshot, setInitialSnapshot] = useState(snapshot(blankForm()))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [existingAttachments, setExistingAttachments] = useState([])
  const [deletedAttachmentIds, setDeletedAttachmentIds] = useState([])

  const loadSections = useCallback(async () => {
    setLoadingSections(true)
    try {
      const response = await api.get('/sections/')
      setSections(Array.isArray(response.data) ? response.data : response.data.results || [])
    } catch (error) {
      if (error.response?.status === 401) onUnauthorized?.()
      else setFormError('Sections could not be loaded. Reopen the form to try again.')
    } finally {
      setLoadingSections(false)
    }
  }, [onUnauthorized])

  const loadActivity = useCallback(async (id) => {
    setLoading(true)
    try {
      const response = await api.get(`/activities/${id}/`)
      const data = response.data || {}
      const [date = '', time = ''] = data.due_date ? data.due_date.split('T') : []
      const loaded = {
        title: data.title || '', description: data.description || '', instructions: data.instructions || '',
        sections: readAssignedSections(data), due_date: date, due_time: time ? time.slice(0, 5) : '',
        max_score: data.max_score !== undefined ? String(data.max_score) : '100', cabinet_station: data.cabinet_station || '',
        status: data.status || 'Published', files: [],
      }
      setForm(loaded)
      setInitialSnapshot(snapshot(loaded))
      setExistingAttachments(data.attachments || [])
    } catch (error) {
      if (error.response?.status === 401) onUnauthorized?.()
      else setFormError('The activity could not be loaded. Close the form and try again.')
    } finally {
      setLoading(false)
    }
  }, [onUnauthorized])

  useEffect(() => {
    if (!isOpen) return
    const timeoutId = window.setTimeout(() => {
      const clean = blankForm()
      setStep(0)
      setForm(clean)
      setInitialSnapshot(snapshot(clean))
      setErrors({})
      setFormError('')
      setSuccessMessage('')
      setExistingAttachments([])
      setDeletedAttachmentIds([])
      loadSections()
      if (editing && resolvedId) loadActivity(resolvedId)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, editing, resolvedId, loadSections, loadActivity])

  const update = (field) => (event) => {
    const value = event?.target ? event.target.value : event
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  const toggleSection = (id) => {
    setForm((current) => ({ ...current, sections: current.sections.includes(id) ? current.sections.filter((value) => value !== id) : [...current.sections, id] }))
    setErrors((current) => ({ ...current, sections: undefined, section: undefined, assigned_sections: undefined }))
  }

  const validateStep = (currentStep) => {
    const nextErrors = {}
    if (currentStep === 0) {
      if (!form.title.trim()) nextErrors.title = 'Enter an activity title.'
      if (form.max_score === '' || Number(form.max_score) < 0) nextErrors.max_score = 'Enter a maximum score of zero or more.'
    }
    if (currentStep === 1 && form.sections.length === 0) nextErrors.sections = 'Select at least one section.'
    if (currentStep === 2 && Boolean(form.due_date) !== Boolean(form.due_time)) {
      nextErrors.due_date = 'Choose both a due date and time, or leave both blank.'
      nextErrors.due_time = 'Choose both a due date and time, or leave both blank.'
    }
    setErrors((current) => ({ ...current, ...nextErrors }))
    return Object.keys(nextErrors).length === 0
  }

  const goNext = () => {
    if (validateStep(step)) setStep((current) => Math.min(current + 1, steps.length - 1))
  }

  const handleFiles = (event) => {
    setForm((current) => ({ ...current, files: Array.from(event.target.files || []) }))
    event.target.value = ''
  }

  const removeNewFile = (_file, index) => setForm((current) => ({ ...current, files: current.files.filter((_, itemIndex) => itemIndex !== index) }))
  const removeExistingFile = (attachment) => {
    setExistingAttachments((current) => current.filter((item) => item.id !== attachment.id))
    if (attachment.id !== undefined) setDeletedAttachmentIds((current) => [...current, attachment.id])
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
    if (editing && !resolvedId) return setFormError('Missing activity id.')

    setSaving(true)
    setErrors({})
    setFormError('')
    setSuccessMessage('')
    const dueDateTime = form.due_date && form.due_time ? `${form.due_date}T${form.due_time}` : form.due_date || null
    const payload = {
      title: form.title, description: form.description, instructions: form.instructions,
      section: form.sections[0] || null, assigned_sections: form.sections, due_date: dueDateTime,
      max_score: form.max_score ? Number(form.max_score) : 100, cabinet_station: form.cabinet_station || '', status: form.status,
    }

    try {
      const body = new FormData()
      Object.entries(payload).forEach(([key, value]) => {
        if (Array.isArray(value)) value.forEach((item) => body.append(key, item))
        else if (value !== null && value !== undefined) body.append(key, value)
      })
      form.files.forEach((file) => body.append('attachments', file))
      deletedAttachmentIds.forEach((id) => body.append('deleted_attachments', id))
      const response = editing ? await api.patch(`/activities/${resolvedId}/`, body) : await api.post('/activities/', body)
      onSaved?.(response.data)
      const updated = editing ? { ...form, files: [] } : blankForm()
      setForm(updated)
      setInitialSnapshot(snapshot(updated))
      setExistingAttachments(response.data.attachments || [])
      setDeletedAttachmentIds([])
      setSuccessMessage(editing ? 'Activity updated successfully.' : 'Activity created successfully.')
    } catch (error) {
      if (error.response?.status === 401) return onUnauthorized?.()
      const data = error.response?.data
      if (data && typeof data === 'object') {
        setErrors(data)
        setFormError(typeof data.detail === 'string' ? data.detail : 'Some fields need your attention.')
        const fieldToStep = { title: 0, description: 0, instructions: 0, max_score: 0, section: 1, sections: 1, assigned_sections: 1, due_date: 2, attachments: 2 }
        const firstField = Object.keys(data).find((field) => fieldToStep[field] !== undefined)
        if (firstField) setStep(fieldToStep[firstField])
      } else setFormError(`Failed to ${editing ? 'update' : 'create'} activity. Please try again.`)
    } finally {
      setSaving(false)
    }
  }

  const selectedSections = useMemo(() => sections.filter((section) => form.sections.includes(getSectionId(section))), [sections, form.sections])
  const dirty = snapshot(form) !== initialSnapshot || deletedAttachmentIds.length > 0

  return (
    <FormDialog
      isOpen={isOpen && (!editing || Boolean(resolvedId))}
      title={editing ? 'Edit Activity' : 'Create New Activity'}
      description={editing ? 'Update the activity while preserving its submissions and history.' : 'Build an activity in four clear steps.'}
      onClose={onClose} onSubmit={handleSubmit} dirty={dirty} busy={saving}
      stepper={<FormStepper steps={steps} currentStep={step} />}
      actions={<FormActions onCancel={onClose} onBack={step > 0 ? () => setStep((current) => current - 1) : undefined} onNext={goNext} isLastStep={step === steps.length - 1} submitLabel={editing ? 'Save changes' : form.status === 'Draft' ? 'Save draft' : 'Publish activity'} busy={saving} disabled={loading || loadingSections} dirty={dirty} />}
      zIndex={editing ? 'z-[99999]' : 'z-[9999]'}
    >
      <div className="space-y-4">
        <InlineFeedback>{formError}</InlineFeedback>
        <InlineFeedback type="success">{successMessage}</InlineFeedback>
        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading activity…</div> : step === 0 ? (
          <FormSection icon={BookOpen} title="Activity details" description="Give students a clear title, purpose, and scoring context.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField label="Activity title" required error={errors.title} className="md:col-span-2">{({ id, describedBy, invalid }) => <input id={id} value={form.title} onChange={update('title')} placeholder="e.g., Chapter 5 Assignment" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <FormField label="Description" optional error={errors.description} className="md:col-span-2">{({ id, describedBy, invalid }) => <textarea id={id} value={form.description} onChange={update('description')} rows={3} placeholder="Summarize the activity and expected outcome." aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid, 'resize-y')} />}</FormField>
              <FormField label="Instructions" optional error={errors.instructions} className="md:col-span-2">{({ id, describedBy, invalid }) => <textarea id={id} value={form.instructions} onChange={update('instructions')} rows={5} placeholder="Add detailed instructions, materials, or submission guidance." aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid, 'resize-y')} />}</FormField>
              <FormField label="Maximum score" required error={errors.max_score} helper="Students will see this as the total available score.">{({ id, describedBy, invalid }) => <input id={id} type="number" min="0" value={form.max_score} onChange={update('max_score')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <FormField label="Cabinet station" optional error={errors.cabinet_station} helper="Use the cabinet label shown on the hardware.">{({ id, describedBy, invalid }) => <input id={id} value={form.cabinet_station} onChange={update('cabinet_station')} placeholder="e.g., Cabinet 1" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
            </div>
          </FormSection>
        ) : step === 1 ? (
          <FormSection icon={Users} title="Assigned sections" description="Choose every class that should receive this activity.">
            <FormField label="Sections" required error={errors.sections || errors.section || errors.assigned_sections} helper="Selected sections appear below as chips.">{({ describedBy, invalid }) => <div className={`max-h-64 overflow-y-auto rounded-xl border bg-white p-2 ${invalid ? 'border-rose-400' : 'border-slate-300'}`} aria-describedby={describedBy}>{loadingSections ? <p className="p-4 text-sm text-slate-500">Loading sections…</p> : sections.length ? sections.map((section) => { const id = getSectionId(section); const selected = form.sections.includes(id); return <label key={id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={selected} onChange={() => toggleSection(id)} className="h-5 w-5 rounded border-slate-300 text-blue-900 focus:ring-blue-900" />{getSectionName(section)}</label> }) : <p className="p-4 text-sm text-slate-500">No sections are available.</p>}</div>}</FormField>
            {selectedSections.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label="Selected sections">{selectedSections.map((section) => <button key={getSectionId(section)} type="button" onClick={() => toggleSection(getSectionId(section))} className="min-h-9 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-900 hover:bg-blue-100" aria-label={`Remove ${getSectionName(section)}`}>{getSectionName(section)} ×</button>)}</div>}
          </FormSection>
        ) : step === 2 ? (
          <FormSection icon={CalendarClock} title="Deadline and attachments" description="Set the due date and provide any files students need.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField label="Due date" optional error={errors.due_date}>{({ id, describedBy, invalid }) => <input id={id} type="date" value={form.due_date} onChange={update('due_date')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <FormField label="Due time" optional error={errors.due_time}>{({ id, describedBy, invalid }) => <input id={id} type="time" value={form.due_time} onChange={update('due_time')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <div className="md:col-span-2"><FileUploadArea files={form.files} onChange={handleFiles} onRemove={removeNewFile} label={form.files.length ? 'Replace selected files' : 'Select activity files'} helper="Choose one or more files. Names and sizes appear before upload." /></div>
              {editing && existingAttachments.length > 0 && <div className="md:col-span-2"><p className="mb-2 text-sm font-semibold text-slate-700">Current attachments</p><FileUploadArea files={existingAttachments} onChange={handleFiles} onRemove={removeExistingFile} label="Add more files" helper="Existing files remain attached unless removed." /></div>}
            </div>
          </FormSection>
        ) : (
          <FormSection icon={ClipboardCheck} title="Review and publish" description="Confirm these details before saving.">
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <ReviewItem label="Title" value={form.title || 'Not provided'} /><ReviewItem label="Maximum score" value={form.max_score || '100'} />
              <ReviewItem label="Sections" value={selectedSections.map(getSectionName).join(', ') || 'None selected'} /><ReviewItem label="Deadline" value={form.due_date ? `${form.due_date}${form.due_time ? ` at ${form.due_time}` : ''}` : 'No deadline'} />
              <ReviewItem label="Cabinet station" value={form.cabinet_station || 'Not specified'} /><ReviewItem label="Files" value={`${existingAttachments.length + form.files.length} attached`} />
              <div className="sm:col-span-2"><ReviewItem label="Description" value={form.description || 'No description'} /></div>
            </dl>
            <FormField label="Publishing status" required error={errors.status} className="mt-5">{({ id, describedBy, invalid }) => <select id={id} value={form.status} onChange={update('status')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)}><option value="Published">Published</option><option value="Draft">Draft</option><option value="Scheduled">Scheduled</option><option value="Archived">Archived</option><option value="Closed">Closed</option></select>}</FormField>
          </FormSection>
        )}
      </div>
    </FormDialog>
  )
}

function ReviewItem({ label, value }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap font-semibold text-[#0B1F3A]">{value}</dd></div>
}
