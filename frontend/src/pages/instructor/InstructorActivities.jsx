import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import DataTable from '../../components/DataTable'
import ActionMenu from '../../components/ActionMenu'
import StatusBadge from '../../components/StatusBadge'
import AddActivityModal from '../../components/activities/AddActivityModal.jsx'
import EditActivityModal from '../../components/activities/EditActivityModal.jsx'
import ViewActivityModal from '../../components/activities/ViewActivityModal.jsx'
import DeleteActivityModal from '../../components/activities/DeleteActivityModal.jsx'
import { Search, Plus, ClipboardList, Edit2, Trash2, Eye } from 'lucide-react'
import { useLocation } from 'react-router-dom'

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

export default function InstructorActivities() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [editingActivityId, setEditingActivityId] = useState(null)
  const [selectedActivity, setSelectedActivity] = useState(null)
  const [deletingActivity, setDeletingActivity] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const location = useLocation()
  const sectionId = new URLSearchParams(location.search).get('section')

  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.get('/activities/', { params: sectionId ? { section: sectionId } : undefined })
      const rawActivities = Array.isArray(response.data) ? response.data : response.data.results || []
      setActivities(rawActivities)
      setError('')
    } catch (err) {
      console.error('Error fetching activities:', err)
      setError('Failed to load activities.')
    } finally {
      setLoading(false)
    }
  }, [sectionId])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchActivities, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchActivities])

  useEffect(() => {
    window.openEditActivityModal = (id, row) => {
      if (!id) return
      setEditingActivityId(id)
      setSelectedActivity(row || null)
      setIsEditModalOpen(true)
    }
    return () => {
      try {
        delete window.openEditActivityModal
      } catch {
        // no-op: best effort cleanup for browser globals
      }
    }
  }, [])

  const handleActivitySaved = async (savedActivity) => {
    if (!savedActivity || !savedActivity.id) {
      await fetchActivities()
      return
    }

    if (editingActivityId) {
      setActivities((existing) =>
        existing.map((activity) => (activity.id === savedActivity.id ? savedActivity : activity))
      )
      setToastMessage('Activity updated successfully.')
    } else {
      setActivities((existing) => [savedActivity, ...existing])
      setToastMessage('Activity created successfully.')
    }

    setIsAddModalOpen(false)
    setIsEditModalOpen(false)
    setIsViewModalOpen(false)
    setEditingActivityId(null)
    setSelectedActivity(null)
    window.setTimeout(() => setToastMessage(''), 4000)
    await fetchActivities()
  }

  const handleActivityDeleted = async (deletedActivityId) => {
    setActivities((existing) => existing.filter((activity) => activity.id !== deletedActivityId))
    setToastMessage('Activity deleted successfully.')
    setIsDeleteModalOpen(false)
    setDeletingActivity(null)
    setIsEditModalOpen(false)
    setEditingActivityId(null)
    setSelectedActivity(null)
    await fetchActivities()
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  const handleOpenEditModal = (id, row) => {
    if (!id) return
    setEditingActivityId(id)
    setSelectedActivity(row || null)
    setIsEditModalOpen(true)
  }

  const handleOpenDeleteModal = (row) => {
    setDeletingActivity(row)
    setIsDeleteModalOpen(true)
  }

  const handleOpenViewModal = (activity) => {
    setSelectedActivity(activity)
    setIsViewModalOpen(true)
  }

  const filteredActivities = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return activities
    return activities.filter((activity) =>
      [activity.title, activity.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    )
  }, [activities, query])

  const columns = [
    { key: 'id', label: 'ID', className: 'min-w-[60px]' },
    { key: 'title', label: 'Title', className: 'min-w-[250px]', render: (value) => value || '—' },
    { key: 'due_date', label: 'Due Date', className: 'min-w-[180px]', render: (value) => formatDate(value) },
    { key: 'created_at', label: 'Created', className: 'min-w-[180px]', render: (value) => formatDate(value) },
    {
      key: 'status',
      label: 'Status',
      className: 'min-w-[120px]',
      render: (value) => {
        const label = value ? String(value).replaceAll('_', ' ') : 'Unknown'
        return <StatusBadge status={label} label={label} />
      },
    },
    {
      key: 'actions',
      label: 'Action',
      className: 'min-w-[110px]',
      render: (_value, row) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleOpenViewModal(row)}
            className="instructor-table-action"
            title="View activity"
          >
            <Eye size={14} />
            View
          </button>
          <ActionMenu
            label={`More actions for ${row.title}`}
            actions={[
              { label: 'Edit', icon: Edit2, onClick: () => handleOpenEditModal(row.id, row) },
              { label: 'Delete', icon: Trash2, onClick: () => handleOpenDeleteModal(row), danger: true },
            ]}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <PageHeader title="My Activities" description="Create and manage your teaching activities" />
        <button
          type="button"
          onClick={() => {
            setEditingActivityId(null)
            setSelectedActivity(null)
            setIsAddModalOpen(true)
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700"
        >
          <Plus size={18} />
          Add Activity
        </button>
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="mb-4 flex w-full flex-col items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white p-3 md:flex-row">
          <div className="flex h-11 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 shadow-sm focus-within:border-transparent focus-within:ring-2 focus-within:ring-blue-900 md:max-w-md">
            <Search size={18} className="text-slate-400" />
            <input type="text" placeholder="Search activities..." value={query} onChange={(e) => setQuery(e.target.value)} className="w-full flex-1 border-0 bg-transparent text-sm outline-none" />
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto" />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading activities...</div>
        ) : filteredActivities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-8 text-center">
            <div className="mb-3 flex justify-center text-4xl text-[#2563EB]">
              <ClipboardList size={32} />
            </div>
            <p className="text-[#6B7280]">
              {query ? 'No activities match your search.' : 'No activities created yet.'}
            </p>
          </div>
        ) : (
          <DataTable columns={columns} rows={filteredActivities} variant="instructor" />
        )}
      </div>

      {toastMessage && (
        <div className="fixed bottom-6 right-6 rounded-lg bg-green-100 px-4 py-3 text-sm font-medium text-green-800 shadow-lg">
          {toastMessage}
        </div>
      )}

      <AddActivityModal
        isOpen={isAddModalOpen && !editingActivityId}
        onClose={() => {
          setIsAddModalOpen(false)
          setEditingActivityId(null)
          setSelectedActivity(null)
        }}
        onSaved={handleActivitySaved}
      />

      <EditActivityModal
        isOpen={isEditModalOpen && !!editingActivityId}
        activityId={editingActivityId}
        activity={selectedActivity}
        onClose={() => {
          setIsEditModalOpen(false)
          setEditingActivityId(null)
          setSelectedActivity(null)
        }}
        onSaved={handleActivitySaved}
      />

      <ViewActivityModal
        isOpen={isViewModalOpen}
        activityId={selectedActivity?.id}
        activity={selectedActivity}
        onClose={() => {
          setIsViewModalOpen(false)
          setSelectedActivity(null)
        }}
        onEdit={() => {
          setIsViewModalOpen(false)
          handleOpenEditModal(selectedActivity?.id, selectedActivity)
        }}
      />

      <DeleteActivityModal
        isOpen={isDeleteModalOpen}
        activity={deletingActivity}
        onClose={() => {
          setIsDeleteModalOpen(false)
          setDeletingActivity(null)
        }}
        onDeleted={handleActivityDeleted}
      />
    </div>
  )
}
