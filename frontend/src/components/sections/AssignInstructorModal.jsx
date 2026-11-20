import { useEffect, useMemo, useState } from 'react'
import { pluralize } from '../../utils/labels.js'
import { AlertCircle, LoaderCircle, UserRound } from 'lucide-react'
import api from '../../services/api.js'
import { fetchAllResults } from '../../services/paginatedResults.js'
import Modal from '../Modal.jsx'

const getInstructorName = (instructor) =>
  instructor.full_name || `${instructor.first_name || ''} ${instructor.last_name || ''}`.trim() || instructor.username || 'Instructor'

const getErrorMessage = (error) => {
  const data = error.response?.data
  const fallback = 'The instructor assignment could not be saved. Please try again.'
  if (typeof data === 'string') return /<!doctype\s+html|<html[\s>]/i.test(data) ? fallback : data
  if (typeof data?.detail === 'string') {
    return /<!doctype\s+html|<html[\s>]/i.test(data.detail) ? fallback : data.detail
  }
  if (data && typeof data === 'object') {
    const messages = Object.values(data).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean)
    if (messages.length) return messages.join(' ')
  }
  return fallback
}

export default function AssignInstructorModal({ isOpen, sections = [], onClose, onAssigned, onUnauthorized }) {
  const [instructors, setInstructors] = useState(null)
  const [instructorId, setInstructorId] = useState('')
  const [confirmReplacement, setConfirmReplacement] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return undefined
    let active = true

    fetchAllResults(api, '/users/', { role: 'instructor', page_size: 100 })
      .then(({ results }) => {
        if (active) {
          setInstructors(results.filter((user) => user.role === 'instructor' && user.is_active === true))
          setError('')
        }
      })
      .catch((requestError) => {
        if (!active) return
        setInstructors([])
        if (requestError.response?.status === 401) onUnauthorized?.()
        setError(getErrorMessage(requestError))
      })

    return () => { active = false }
  }, [isOpen, onUnauthorized])

  const loadingInstructors = isOpen && instructors === null
  const availableInstructors = useMemo(() => instructors || [], [instructors])
  const selectedInstructor = availableInstructors.find((instructor) => String(instructor.id) === instructorId)
  const instructorName = selectedInstructor ? getInstructorName(selectedInstructor) : ''
  const replacementSections = selectedInstructor
    ? sections.filter((section) => section.instructor && String(section.instructor) !== instructorId)
    : []
  const handleClose = () => {
    setInstructors(null)
    setInstructorId('')
    setConfirmReplacement(false)
    setError('')
    onClose?.()
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving || loadingInstructors) return
    if (!sections.length) return setError('Select at least one section to assign.')
    if (!selectedInstructor) return setError('Choose a registered instructor.')
    if (replacementSections.length && !confirmReplacement) return setError('Confirm the instructor replacement to continue.')

    setSaving(true)
    setError('')
    try {
      const response = await api.patch('/sections/assign-instructor/', {
        section_ids: sections.map((section) => Number(section.id)),
        instructor_id: Number(selectedInstructor.id),
      }, { timeout: 30_000 })
      await onAssigned?.(response.data)
      onClose?.()
    } catch (requestError) {
      if (requestError.response?.status === 401) onUnauthorized?.()
      setError(getErrorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Assign Instructor"
      description="Choose the instructor responsible for the selected sections."
      busy={saving}
      maxWidth="min(94vw, 600px)"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={17} className="mt-0.5 shrink-0" /><span>{error}</span></div>}

        <section className="rounded-lg border border-[#dbe5f0] bg-[#eef4fa] p-4" aria-label="Selected sections">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#102a4c]">Selected sections</h3>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#082b53]">{sections.length}</span>
          </div>
          <ul className="mt-3 max-h-32 space-y-2 overflow-y-auto">
            {sections.map((section) => (
              <li key={section.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#dbe5f0] bg-white px-3 py-2 text-sm">
                <span className="font-semibold text-[#102a4c]">{section.subject_code ? `${section.subject_code} · ` : ''}{section.section_name || 'Unnamed section'}</span>
                <span className="text-xs text-[#64748b]">{section.instructor_name || 'No instructor assigned'}</span>
              </li>
            ))}
          </ul>
        </section>

        <div>
          <label htmlFor="assign-instructor-select" className="sr-only">Instructor</label>
          <div className="relative mt-2">
            <UserRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]" aria-hidden="true" />
            <select id="assign-instructor-select" value={instructorId} onChange={(event) => { setInstructorId(event.target.value); setConfirmReplacement(false); setError('') }} className="tt-control w-full pl-10" disabled={loadingInstructors || saving}>
              <option value="">{loadingInstructors ? 'Loading instructors…' : availableInstructors.length ? 'Select an instructor' : 'No eligible instructors available'}</option>
              {availableInstructors.map((instructor) => (
                <option key={instructor.id} value={instructor.id}>
                  {getInstructorName(instructor)}{instructor.instructor_id ? ` · ${instructor.instructor_id}` : ''}{instructor.email ? ` · ${instructor.email}` : ''}
                </option>
              ))}
            </select>
          </div>
          {selectedInstructor && <p className="mt-2 text-xs text-[#64748b]">{selectedInstructor.email || selectedInstructor.username || 'Registered instructor'}</p>}
        </div>

        {replacementSections.length > 0 && (
          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <input type="checkbox" checked={confirmReplacement} onChange={(event) => { setConfirmReplacement(event.target.checked); setError('') }} className="mt-0.5 h-4 w-4 accent-[#082b53]" disabled={saving} />
            <span>Replace the current instructor for {pluralize(replacementSections.length, 'selected section')} with {instructorName}.</span>
          </label>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-[#dbe5f0] pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={handleClose} disabled={saving} className="tt-button tt-button-secondary w-full sm:w-auto">Cancel</button>
          <button type="submit" disabled={saving || loadingInstructors || !instructorId || (replacementSections.length > 0 && !confirmReplacement)} className="tt-button tt-button-primary w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? <><LoaderCircle size={16} className="animate-spin" />Assigning…</> : 'Confirm Assignment'}
          </button>
        </div>
      </form>
    </Modal>
  )
}