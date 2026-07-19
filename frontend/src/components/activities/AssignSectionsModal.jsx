import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import Modal from '../Modal.jsx'

const getSectionId = (section) => section?.id ?? section?.section_id ?? section?.section?.id ?? null

export default function AssignSectionsModal({ isOpen, activity, onClose, onSaved, onUnauthorized }) {
  const [sections, setSections] = useState([])
  const [selectedSectionIds, setSelectedSectionIds] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!isOpen) return

    const initialIds = Array.isArray(activity?.assigned_sections)
      ? activity.assigned_sections
          .map((section) => getSectionId(section))
          .filter(Boolean)
      : []

    setSelectedSectionIds(initialIds)
    setErrorMessage('')
    loadSections()
  }, [isOpen, activity?.id])

  const loadSections = async () => {
    setLoading(true)
    try {
      const response = await api.get('/sections/')
      const data = Array.isArray(response.data) ? response.data : response.data.results || []
      setSections(data)
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized?.()
      } else {
        console.error('Failed to load sections', err)
        setErrorMessage('Failed to load sections.')
      }
    } finally {
      setLoading(false)
    }
  }

  const toggleSection = (sectionId) => {
    setSelectedSectionIds((current) => {
      if (current.includes(sectionId)) {
        return current.filter((value) => value !== sectionId)
      }
      return [...current, sectionId]
    })
  }

  const handleSave = async () => {
    if (!activity?.id) return

    setSaving(true)
    setErrorMessage('')

    try {
      const response = await api.patch(`/activities/${activity.id}/`, {
        assigned_sections: selectedSectionIds,
      })
      onSaved?.(response.data)
      onClose?.()
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized?.()
        return
      }
      console.error('Failed to update activity sections', err)
      setErrorMessage(err.response?.data?.detail || 'Failed to update sections. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const sectionOptions = useMemo(() => {
    return sections.map((section) => ({
      id: getSectionId(section),
      label: section?.name || section?.section_name || section?.code || 'Section',
    })).filter((section) => section.id != null)
  }, [sections])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assign Sections">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Select the sections that should receive this activity.</p>

        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
        )}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">Loading sections...</div>
        ) : sectionOptions.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No sections available.</div>
        ) : (
          <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
            {sectionOptions.map((section) => {
              const isSelected = selectedSectionIds.includes(section.id)
              return (
                <label key={section.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSection(section.id)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{section.label}</span>
                </label>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || loading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
