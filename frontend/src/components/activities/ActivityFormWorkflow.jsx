import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, CalendarClock, ClipboardCheck, LoaderCircle, PencilLine, Users } from 'lucide-react'
import api from '../../services/api.js'
import AcademicFileAttachments from '../files/AcademicFileAttachments.jsx'
import { SUPPORTED_UPLOAD_ACCEPT, validateUploadFiles } from '../files/uploadPolicy.js'
import ActivityDiscussion from '../ActivityDiscussion.jsx'
import StatusBadge from '../StatusBadge.jsx'
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

const editSteps = ['Activity Details', 'Assigned Sections', 'Deadline & Files', 'Review & Publish']
const viewSteps = ['Activity Details', 'Assigned Sections', 'Deadline & Files', 'Activity Status / Review', 'Discussion']
const blankForm = () => ({ title: '', description: '', instructions: '', sections: [], due_date: '', due_time: '', max_score: '100', status: 'Draft', files: [] })
const getSectionId = (section) => section?.id ?? section?.section_id ?? section?.subject_code
const getSectionName = (section) => section?.section_name || section?.name || section?.title || section?.subject_code || 'Unnamed section'
const displayValue = (value) => value === null || value === undefined || String(value).trim() === '' ? 'Not recorded' : String(value)
const snapshot = (form) => JSON.stringify({ ...form, files: form.files.map((file) => `${file.name}:${file.size}`) })

const formatActivityDate = (value) => {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(date)
}

const formatActivityTime = (value) => {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' }).format(date)
}

function ReadOnlyActivityStep({ step, activity, sections, attachments, activityId }) {
  if (step === 0) {
    return (
      <FormSection icon={BookOpen} title="Activity details" description="Read-only activity information.">
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <ReviewItem label="Activity title" value={displayValue(activity?.title)} />
          <ReviewItem label="Maximum score" value={displayValue(activity?.max_score)} />
          <ReviewItem label="Description" value={displayValue(activity?.description)} />
          <div className="sm:col-span-2"><ReviewItem label="Instructions" value={displayValue(activity?.instructions)} /></div>
        </dl>
      </FormSection>
    )
  }

  if (step === 1) {
    return (
      <FormSection icon={Users} title="Assigned sections" description="Classes currently assigned to this activity.">
        {sections.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {sections.map((section) => (
              <div key={getSectionId(section)} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-semibold text-[#0B1F3A]">{getSectionName(section)}</h4>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <ReviewItem label="Year level" value={displayValue(section.year_level)} />
                  <div className="col-span-2"><ReviewItem label="Students" value={displayValue(section.student_count)} /></div>
                </dl>
              </div>
            ))}
          </div>
        ) : <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">No assigned sections are recorded for this activity.</p>}
      </FormSection>
    )
  }

  if (step === 2) {
    return (
      <FormSection icon={CalendarClock} title="Deadline & files" description="Due information, requirements, and attached activity files.">
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <ReviewItem label="Due date" value={formatActivityDate(activity?.due_date)} />
          <ReviewItem label="Deadline / time" value={formatActivityTime(activity?.due_date)} />
          <ReviewItem label="Activity type" value={displayValue(activity?.activity_type)} />
          <ReviewItem label="Resubmissions" value={activity?.allow_resubmission === undefined ? 'Not recorded' : activity.allow_resubmission ? 'Allowed' : 'Not allowed'} />
        </dl>
        <div className="mt-5">
          <h4 className="mb-3 text-sm font-semibold text-[#0B1F3A]">Attached files</h4>
          <AcademicFileAttachments attachments={attachments} kind="activity" emptyMessage="No activity files are attached." />
        </div>
      </FormSection>
    )
  }

  if (step === 3) {
    const status = displayValue(activity?.status)
    return (
      <FormSection icon={ClipboardCheck} title="Activity status / review" description="Publication status and audit timestamps from the activity record.">
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><dt className="text-xs font-bold uppercase text-slate-500">Status</dt><dd className="mt-2"><StatusBadge status={String(status).toLowerCase()} label={status} /></dd></div>
          <ReviewItem label="Created date" value={formatActivityDate(activity?.created_at)} />
          <ReviewItem label="Last updated" value={formatActivityDate(activity?.updated_at)} />
          <div className="sm:col-span-2"><ReviewItem label="Publication information" value={activity?.status ? `Current publication status: ${activity.status}` : 'Not recorded'} /></div>
        </dl>
      </FormSection>
    )
  }

  return (
    <ActivityDiscussion activityId={activityId} />
  )
}

function readAssignedSections(data) {
  if (Array.isArray(data.assigned_sections) && data.assigned_sections.length) {
    return data.assigned_sections.map((section) => getSectionId(section) ?? section).filter((value) => value !== undefined && value !== null)
  }
  return data.section !== undefined && data.section !== null && data.section !== '' ? [getSectionId(data.section) ?? data.section] : []
}

export default function ActivityFormWorkflow({ isOpen, activityId, activity, onClose, onEdit, onUnauthorized, onSaved, mode = 'create' }) {
  const resolvedId = activity?.id ?? activityId
  const editing = mode === 'edit'
  const viewing = mode === 'view'
  const currentSteps = viewing ? viewSteps : editSteps
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingStatus, setSavingStatus] = useState(null)
  const [creationCompleted, setCreationCompleted] = useState(false)
  const [loadingSections, setLoadingSections] = useState(false)
  const [sections, setSections] = useState([])
  const [form, setForm] = useState(blankForm())
  const [initialSnapshot, setInitialSnapshot] = useState(snapshot(blankForm()))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [existingAttachments, setExistingAttachments] = useState([])
  const [activityRecord, setActivityRecord] = useState(activity || null)
  const [deletedAttachmentIds, setDeletedAttachmentIds] = useState([])
  const submissionGuardRef = useRef(false)

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
      setActivityRecord(data)
      const [date = '', time = ''] = data.due_date ? data.due_date.split('T') : []
      const loaded = {
        title: data.title || '', description: data.description || '', instructions: data.instructions || '',
        sections: readAssignedSections(data), due_date: date, due_time: time ? time.slice(0, 5) : '',
        max_score: data.max_score !== undefined ? String(data.max_score) : '100',
        status: data.status || 'Draft', files: [],
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
      submissionGuardRef.current = false
      setCreationCompleted(false)
      setExistingAttachments([])
      setActivityRecord(null)
      setDeletedAttachmentIds([])
      loadSections()
      if ((editing || viewing) && resolvedId) loadActivity(resolvedId)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, editing, viewing, resolvedId, loadSections, loadActivity])

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

  const handleNextStep = () => {
    if (viewing) {
      setStep((current) => Math.min(current + 1, currentSteps.length - 1))
      return
    }
    if (validateStep(step)) setStep((current) => Math.min(current + 1, currentSteps.length - 1))
  }

  const handlePreviousStep = () => setStep((current) => Math.max(0, current - 1))

  const handleFiles = (event) => {
    const selectedFiles = Array.from(event.target.files || [])
    const uploadErrors = validateUploadFiles(selectedFiles)
    if (uploadErrors.length) {
      setErrors((current) => ({ ...current, attachments: uploadErrors }))
      event.target.value = ''
      return
    }
    setForm((current) => {
      const seen = new Set(current.files.map((file) => `${file.name}:${file.size}:${file.type}:${file.lastModified}`))
      const nextFiles = [...current.files]

      selectedFiles.forEach((file) => {
        const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`
        if (!seen.has(key)) {
          seen.add(key)
          nextFiles.push(file)
        }
      })

      return { ...current, files: nextFiles }
    })
    setErrors((current) => ({ ...current, attachments: undefined }))
    event.target.value = ''
  }

  const removeNewFile = (_file, index) => setForm((current) => ({ ...current, files: current.files.filter((_, itemIndex) => itemIndex !== index) }))
  const removeExistingFile = (attachment) => {
    setExistingAttachments((current) => current.filter((item) => item.id !== attachment.id))
    if (attachment.id !== undefined) setDeletedAttachmentIds((current) => [...current, attachment.id])
  }

  const preventImplicitSubmit = (event) => event.preventDefault()

  const handleSaveActivity = async (nextStatus = form.status) => {
    if (step !== currentSteps.length - 1) return
    if (saving || submissionGuardRef.current || (!editing && creationCompleted)) return
    const validationResults = [0, 1, 2].map((stepIndex) => validateStep(stepIndex))
    const firstInvalidStep = validationResults.indexOf(false)
    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep)
      return
    }
    if (editing && !resolvedId) return setFormError('Missing activity id.')

    submissionGuardRef.current = true
    setSaving(true)
    setSavingStatus(nextStatus)
    setErrors({})
    setFormError('')
    setSuccessMessage('')
    const dueDateTime = form.due_date && form.due_time ? `${form.due_date}T${form.due_time}` : form.due_date || null
    const payload = {
      title: form.title, description: form.description, instructions: form.instructions,
      section: form.sections[0] || null, assigned_sections: form.sections, due_date: dueDateTime,
      max_score: form.max_score ? Number(form.max_score) : 100, status: nextStatus,
    }

    try {
      const body = new FormData()
      Object.entries(payload).forEach(([key, value]) => {
        if (Array.isArray(value)) value.forEach((item) => body.append(key, item))
        else if (value !== null && value !== undefined) body.append(key, value)
      })
      form.files.forEach((file) => body.append('attachments', file))
      deletedAttachmentIds.forEach((id) => body.append('deleted_attachments', id))
      const requestOptions = { timeout: form.files.length ? 10 * 60 * 1000 : 60_000 }
      const response = editing
        ? await api.patch(`/activities/${resolvedId}/`, body, requestOptions)
        : await api.post('/activities/', body, requestOptions)
      if (!editing) setCreationCompleted(true)
      onSaved?.(response.data)
      const updated = editing ? { ...form, status: response.data.status || nextStatus, files: [] } : blankForm()
      setForm(updated)
      setInitialSnapshot(snapshot(updated))
      if (editing) setActivityRecord(response.data)
      setExistingAttachments(response.data.attachments || [])
      setDeletedAttachmentIds([])
      setSuccessMessage(editing
        ? nextStatus === 'Published' && activityRecord?.status !== 'Published' ? 'Activity published successfully.' : 'Activity updated successfully.'
        : nextStatus === 'Published' ? 'Activity published successfully.' : 'Draft saved successfully.')
    } catch (error) {
      if (error.response?.status === 401) return onUnauthorized?.()
      const data = error.response?.data
      const contentType = String(error.response?.headers?.['content-type'] || '').toLowerCase()
      const rawMessage = typeof data === 'string' ? data : typeof data?.detail === 'string' ? data.detail : ''
      const isHtmlError = contentType.includes('text/html') || /<!doctype\s+html|<html[\s>]/i.test(rawMessage)
      if (isHtmlError) {
        setErrors({})
        setFormError(`Failed to ${editing ? 'update' : 'create'} activity. Please try again.`)
      } else if (data && typeof data === 'object') {
        setErrors(data)
        setFormError(typeof data.detail === 'string' ? data.detail : 'Some fields need your attention.')
        const fieldToStep = { title: 0, description: 0, instructions: 0, max_score: 0, section: 1, sections: 1, assigned_sections: 1, due_date: 2, attachments: 2 }
        const firstField = Object.keys(data).find((field) => fieldToStep[field] !== undefined)
        if (firstField) setStep(fieldToStep[firstField])
      } else setFormError(`Failed to ${editing ? 'update' : 'create'} activity. Please try again.`)
    } finally {
      submissionGuardRef.current = false
      setSaving(false)
      setSavingStatus(null)
    }
  }

  const selectedSections = useMemo(() => sections.filter((section) => form.sections.includes(getSectionId(section))), [sections, form.sections])
  const dirty = snapshot(form) !== initialSnapshot || deletedAttachmentIds.length > 0

  return (
    <FormDialog
      isOpen={isOpen && ((!editing && !viewing) || Boolean(resolvedId))}
      title={viewing ? 'View Activity' : editing ? 'Edit Activity' : 'Create New Activity'}
      description={viewing ? 'Read-only activity record and discussion.' : editing ? 'Update the activity while preserving its submissions and history.' : 'Build an activity in four clear steps.'}
      onClose={onClose} onSubmit={preventImplicitSubmit}
      asForm={!viewing}
      headerActions={viewing && <button type="button" onClick={onEdit} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#F5B700] px-4 py-2 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400"><PencilLine size={16} />Edit Activity</button>}
      dirty={viewing ? false : dirty}
      busy={viewing ? false : saving}
      stepper={<FormStepper steps={currentSteps} currentStep={step} />}
      actions={(
        <div className="space-y-3">
          <FormActions
            onCancel={onClose}
            onBack={step > 0 ? handlePreviousStep : undefined}
            onNext={handleNextStep}
            isLastStep={step === currentSteps.length - 1}
            submitLabel={viewing ? 'Close' : 'Save as Draft'}
            busyLabel="Saving…"
            busy={viewing ? false : saving}
            disabled={loading || loadingSections || (!editing && creationCompleted)}
            dirty={viewing ? false : dirty}
            finalButtonType="button"
            onFinalAction={viewing ? onClose : undefined}
            finalActions={!viewing && step === currentSteps.length - 1 && (
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => handleSaveActivity('Draft')}
                  disabled={saving || loading || loadingSections || (!editing && creationCompleted)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-[#0B1F3A] transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && savingStatus === 'Draft' ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />Saving…</> : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveActivity('Published')}
                  disabled={saving || loading || loadingSections || (!editing && creationCompleted)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#082B53] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#123e6b] focus:outline-none focus:ring-2 focus:ring-[#FFBE0B] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && savingStatus === 'Published' ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />Publishing…</> : 'Publish Activity'}
                </button>
              </div>
            )}
          />
        </div>
      )}
      zIndex={editing ? 'z-[99999]' : 'z-[9999]'}
    >
      <div className="space-y-4" onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) && event.target.type !== 'file') {
          event.preventDefault()
        }
      }}>
        <InlineFeedback>{formError}</InlineFeedback>
        <InlineFeedback type="success">{successMessage}</InlineFeedback>
        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading activity…</div> : viewing ? (
          <ReadOnlyActivityStep step={step} activity={activityRecord} sections={selectedSections} attachments={existingAttachments} activityId={resolvedId} />
        ) : step === 0 ? (
          <FormSection icon={BookOpen} title="Activity details" description="Give students a clear title, purpose, and scoring context.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField label="Activity title" required error={errors.title} className="md:col-span-2">{({ id, describedBy, invalid }) => <input id={id} value={form.title} onChange={update('title')} placeholder="e.g., Chapter 5 Assignment" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
              <FormField label="Description" optional error={errors.description} className="md:col-span-2">{({ id, describedBy, invalid }) => <textarea id={id} value={form.description} onChange={update('description')} rows={3} placeholder="Summarize the activity and expected outcome." aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid, 'resize-y')} />}</FormField>
              <FormField label="Instructions" optional error={errors.instructions} className="md:col-span-2">{({ id, describedBy, invalid }) => <textarea id={id} value={form.instructions} onChange={update('instructions')} rows={5} placeholder="Add detailed instructions, materials, or submission guidance." aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid, 'resize-y')} />}</FormField>
              <FormField label="Maximum score" required error={errors.max_score} helper="Students will see this as the total available score.">{({ id, describedBy, invalid }) => <input id={id} type="number" min="0" value={form.max_score} onChange={update('max_score')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)} />}</FormField>
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
              <div className="md:col-span-2"><FileUploadArea files={form.files} onChange={handleFiles} onRemove={removeNewFile} accept={SUPPORTED_UPLOAD_ACCEPT} error={errors.attachments} label={form.files.length ? 'Add more files' : 'Select activity files'} helper="Choose one or more files. Names and sizes appear before upload." /></div>
              {editing && existingAttachments.length > 0 && <div className="md:col-span-2"><p className="mb-2 text-sm font-semibold text-slate-700">Current attachments</p><FileUploadArea files={existingAttachments} onChange={handleFiles} onRemove={removeExistingFile} accept={SUPPORTED_UPLOAD_ACCEPT} label="Add more files" helper="Existing files remain attached unless removed." /></div>}
            </div>
          </FormSection>
        ) : (
          <FormSection icon={ClipboardCheck} title="Review activity" description="Confirm these details before saving.">
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <ReviewItem label="Title" value={form.title || 'Not provided'} /><ReviewItem label="Maximum score" value={form.max_score || '100'} />
              <ReviewItem label="Sections" value={selectedSections.map(getSectionName).join(', ') || 'None selected'} /><ReviewItem label="Deadline" value={form.due_date ? `${form.due_date}${form.due_time ? ` at ${form.due_time}` : ''}` : 'No deadline'} />
              <ReviewItem label="Attachments" value={[...existingAttachments.map((file) => file.filename || file.file_name || file.name || 'Attachment'), ...form.files.map((file) => file.name)].join(', ') || 'None attached'} />
              <div className="sm:col-span-2"><ReviewItem label="Description" value={form.description || 'No description'} /></div>
              <div className="sm:col-span-2"><ReviewItem label="Instructions" value={form.instructions || 'No instructions'} /></div>
            </dl>
          </FormSection>
        )}
      </div>
    </FormDialog>
  )
}

function ReviewItem({ label, value }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap font-semibold text-[#0B1F3A]">{value}</dd></div>
}
