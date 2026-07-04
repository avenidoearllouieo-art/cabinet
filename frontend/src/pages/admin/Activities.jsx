import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import EditActivityModal from '../../components/activities/EditActivityModal.jsx'
import DeleteActivityModal from '../../components/activities/DeleteActivityModal.jsx'
import { Search, ClipboardList, CalendarDays, CheckCircle2, Edit2, Trash2 } from 'lucide-react'

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

export default function Activities() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [editingActivityId, setEditingActivityId] = useState(null)
  const [selectedActivity, setSelectedActivity] = useState(null)
  const [deletingActivity, setDeletingActivity] = useState(null)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    fetchActivities()
  }, [])

  useEffect(() => {
    // expose a global helper so Edit buttons rendered by DataTable can open the modal
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

  const handleActivitySaved = (savedActivity) => {
    if (!savedActivity || !savedActivity.id) {
      fetchActivities()
      return
    }

    setActivities((existingActivities) => {
      return existingActivities.map((activity) => (activity.id === savedActivity.id ? savedActivity : activity))
    })

    setToastMessage('Activity updated successfully.')
    setIsEditModalOpen(false)
    setEditingActivityId(null)
    setSelectedActivity(null)
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  const handleActivityDeleted = async (deletedActivityId) => {
    setActivities((existingActivities) => existingActivities.filter((activity) => activity.id !== deletedActivityId))
    setToastMessage('Activity deleted successfully.')
    setIsDeleteModalOpen(false)
    setDeletingActivity(null)
    setIsEditModalOpen(false)
    setEditingActivityId(null)
    setSelectedActivity(null)
    window.setTimeout(() => setToastMessage(''), 4000)

    try {
      await fetchActivities()
    } catch (err) {
      console.error('Failed to refresh activities after delete', err)
    }
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
      [activity.title, activity.description, activity.activity_type, activity.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    )
  }, [activities, query])

  const totalActivities = activities.length
  const activeActivities = activities.filter((activity) => {
    if (typeof activity.is_active !== 'undefined') return activity.is_active
    if (typeof activity.status !== 'undefined') return String(activity.status).toLowerCase() === 'active'
    return true
  }).length

  const completedActivities = activities.filter((activity) => {
    if (typeof activity.is_completed !== 'undefined') return activity.is_completed
    if (typeof activity.status !== 'undefined') return String(activity.status).toLowerCase() === 'completed'
    return false
  }).length

  const supportsCompletion = activities.some(
    (activity) => typeof activity.is_completed !== 'undefined' || typeof activity.status !== 'undefined',
  )

  const columns = [
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[140px]',
      render: (_value, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenEditModal(row.id, row)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            title="Edit activity"
          >
            <Edit2 size={14} />
            Edit
          </button>
          <button
            onClick={() => handleOpenDeleteModal(row)}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
            title="Delete activity"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      ),
    },
    {
      key: 'title',
      label: 'Title',
      className: 'min-w-[220px]',
    },
    {
      key: 'description',
      label: 'Description',
      className: 'min-w-[280px] max-w-[420px]',
      render: (value) => <span className="line-clamp-2 block text-sm text-[#374151]">{value || '—'}</span>,
    },
    {
      key: 'activity_type',
      label: 'Type',
      render: (_value, row) => row.activity_type || row.type || '—',
    },
    {
      key: 'due_date',
      label: 'Due Date',
      render: (value) => formatDate(value),
    },
    {
      key: 'created_by_name',
      label: 'Created By',
      render: (value, row) => value || row.created_by || '—',
    },
    {
      key: 'created_at',
      label: 'Created At',
      render: (value) => formatDate(value),
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Activities Management"
        description="Browse and search system activities."
      />

      <div className="grid gap-6 md:grid-cols-3">
        <StatCard icon={<ClipboardList size={18} />} label="Total Activities" value={totalActivities} subtitle="All published activities" />
        <StatCard icon={<CalendarDays size={18} />} label="Active Activities" value={activeActivities} subtitle="Activities still in progress" />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label="Completed Activities"
          value={supportsCompletion ? completedActivities : 'N/A'}
          subtitle={supportsCompletion ? 'Marked complete by API' : 'Completion status unavailable'}
        />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Activity Directory</h2>
            <p className="text-sm text-[#6B7280]">View activities fetched from the API.</p>
          </div>

          <label className="relative block w-full md:w-[360px]">
            <span className="sr-only">Search activities</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, description, or type"
              className="w-full rounded-full border border-[#E5E7EB] bg-[#F9FAFB] py-3 pl-11 pr-4 text-sm text-[#111827] shadow-sm outline-none transition focus:border-[#2563EB] focus:bg-white"
            />
          </label>
        </div>

        <DataTable columns={columns} data={filteredActivities} loading={loading} showActions={false} />
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      <EditActivityModal
        isOpen={isEditModalOpen}
        activityId={editingActivityId}
        activity={selectedActivity}
        onClose={() => {
          setIsEditModalOpen(false)
          setEditingActivityId(null)
          setSelectedActivity(null)
        }}
        onUnauthorized={() => {
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
        onUnauthorized={() => {
          setIsDeleteModalOpen(false)
          setDeletingActivity(null)
        }}
        onDeleted={handleActivityDeleted}
      />
    </div>
  )
}
