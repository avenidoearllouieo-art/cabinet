import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import Modal from '../Modal.jsx'

const getSectionId = (section) => section?.id ?? section?.section_id ?? section?.section?.id ?? null

export default function AssignSectionsModal({ isOpen, activity, onClose, onSaved, onUnauthorized }) {
  const [sections, setSections] = useState([])
  const [selectedSectionIds, setSelectedSectionIds] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const loadSections = useCallback(async () => {
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
  }, [onUnauthorized])

  useEffect(() => {
    if (!isOpen) return
    const timeoutId = window.setTimeout(() => {
      const initialIds = Array.isArray(activity?.assigned_sections)
        ? activity.assigned_sections.map((section) => getSectionId(section)).filter(Boolean)
        : []
      setSelectedSectionIds(initialIds)
      setErrorMessage('')
      loadSections()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, activity, loadSections])

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

  const initialSectionIds = useMemo(() => Array.isArray(activity?.assigned_sections) ? activity.assigned_sections.map((section) => getSectionId(section)).filter(Boolean) : [], [activity])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assign Sections" description="Choose every class that should receive this activity." dirty={JSON.stringify([...selectedSectionIds].sort()) !== JSON.stringify([...initialSectionIds].sort())} busy={saving}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Select the sections that should receive this activity.</p>

        {errorMessage && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
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
                <label key={section.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSection(section.id)}
                    className="h-5 w-5 rounded border-slate-300 text-blue-900 focus:ring-blue-900"
                  />
                  <span>{section.label}</span>
                </label>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-900">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || loading} className="min-h-11 rounded-xl bg-[#F5B700] px-5 py-2 text-sm font-bold text-[#0B1F3A] hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
