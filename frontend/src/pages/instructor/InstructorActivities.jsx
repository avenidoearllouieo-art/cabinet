import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import DataTable from '../../components/DataTable'
import AddActivityModal from '../../components/activities/AddActivityModal.jsx'
import EditActivityModal from '../../components/activities/EditActivityModal.jsx'
import DeleteActivityModal from '../../components/activities/DeleteActivityModal.jsx'
import { Search, Plus, ClipboardList, Edit2, Trash2, Eye } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch (err) {
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
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [editingActivityId, setEditingActivityId] = useState(null)
  const [selectedActivity, setSelectedActivity] = useState(null)
  const [deletingActivity, setDeletingActivity] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetchActivities()
  }, [])

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
      } catch (err) {}
    }
  }, [])

  const fetchActivities = async () => {
    try {
      setLoading(true)
      const response = await api.get('/activities/')
      const rawActivities = Array.isArray(response.data) ? response.data : response.data.results || []
      setActivities(rawActivities)
      setError('')
    } catch (err) {
      console.error('Error fetching activities:', err)
      setError('Failed to load activities.')
    } finally {
      setLoading(false)
    }
  }

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
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[140px]',
      render: (_value, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/instructor/activities/${row.id}`, { state: { activity: row } })}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-blue-700"
            title="View activity"
          >
            <Eye size={14} />
            View
          </button>
          <button
            onClick={() => handleOpenEditModal(row.id, row)}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-600 bg-white px-2 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-50"
            title="Edit activity"
          >
            <Edit2 size={14} />
            Edit
          </button>
          <button
            onClick={() => handleOpenDeleteModal(row)}
            className="inline-flex items-center gap-1 rounded-lg border border-red-600 bg-red-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-red-700"
            title="Delete activity"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
    { key: 'id', label: 'ID', className: 'min-w-[60px]' },
    { key: 'title', label: 'Title', className: 'min-w-[250px]', render: (v) => v || '—' },
    {
      key: 'due_date',
      label: 'Due Date',
      className: 'min-w-[180px]',
      render: (v) => formatDate(v),
    },
    {
      key: 'created_at',
      label: 'Created',
      className: 'min-w-[180px]',
      render: (v) => formatDate(v),
    },
  ]

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <PageHeader
          title="My Activities"
          description="Create and manage your teaching activities"
        />
        <button
          onClick={() => {
            setEditingActivityId(null)
            setSelectedActivity(null)
            setIsAddModalOpen(true)
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition hover:bg-blue-700"
        >
          <Plus size={18} />
          Add Activity
        </button>
      </div>

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <Search size={18} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search activities..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 border-0 bg-transparent text-sm outline-none"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading activities...</div>
        ) : filteredActivities.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-16 text-center">
            <div className="mb-3 flex justify-center text-4xl text-[#2563EB]">
              <ClipboardList size={32} />
            </div>
            <p className="text-[#6B7280]">
              {query ? 'No activities match your search.' : 'No activities created yet.'}
            </p>
          </div>
        ) : (
          <DataTable columns={columns} rows={filteredActivities} />
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
