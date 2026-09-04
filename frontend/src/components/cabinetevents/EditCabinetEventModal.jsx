import { useCallback, useEffect, useState } from 'react'
import { RadioTower } from 'lucide-react'
import api from '../../services/api.js'
import { controlClass } from '../forms/formStyles.js'
import { FormActions, FormDialog, FormField, FormSection, InlineFeedback } from '../forms/FormPrimitives.jsx'

const EMPTY_EVENT_FORM = { status: '', remarks: '' }

export default function EditCabinetEventModal({ isOpen, eventId, event, onClose, onUnauthorized, onSaved }) {
  const resolvedEventId = event?.id ?? eventId
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')

  const [form, setForm] = useState(EMPTY_EVENT_FORM)
  const [initialForm, setInitialForm] = useState(EMPTY_EVENT_FORM)

  const fetchEvent = useCallback(async (id) => {
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
        onUnauthorized?.()
      } else {
        console.error('Failed to load event', e)
        setFormError('Failed to load event.')
      }
    } finally {
      setLoading(false)
    }
  }, [onUnauthorized])

  useEffect(() => {
    if (!isOpen) return
    const timeoutId = window.setTimeout(() => {
      setErrors({})
      setFormError('')
      setForm(EMPTY_EVENT_FORM)
      setInitialForm(EMPTY_EVENT_FORM)
      if (resolvedEventId) fetchEvent(resolvedEventId)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, resolvedEventId, fetchEvent])

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

  return (
    <FormDialog isOpen title={title} description="Update the recorded hardware state and operator remarks." onClose={onClose} onSubmit={handleSubmit} dirty={JSON.stringify(form) !== JSON.stringify(initialForm)} busy={saving} maxWidth="max-w-xl" zIndex="z-[99999]" actions={<FormActions onCancel={onClose} isLastStep submitLabel={submitLabel} busy={saving} disabled={loading} dirty={JSON.stringify(form) !== JSON.stringify(initialForm)} />}>
      <div className="space-y-4"><InlineFeedback>{formError}</InlineFeedback>{loading ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading event…</div> : <FormSection icon={RadioTower} title="Cabinet event" description="Use remarks to explain any manual correction."><div className="space-y-5">
        <FormField label="Status" required error={errors.status}>{({ id, describedBy, invalid }) => <select id={id} value={form.status} onChange={handleChange('status')} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid)}><option value="">Select status</option><option value="Opened">Opened</option><option value="Closed">Closed</option><option value="Unlocked">Unlocked</option><option value="Locked">Locked</option></select>}</FormField>
        <FormField label="Remarks" optional error={errors.remarks}>{({ id, describedBy, invalid }) => <textarea id={id} value={form.remarks} onChange={handleChange('remarks')} rows={5} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid, 'resize-y')} />}</FormField>
      </div></FormSection>}</div>
    </FormDialog>
  )
}
