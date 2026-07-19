import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal.jsx'
import ActivityActionsMenu from '../../components/activities/ActivityActionsMenu.jsx'
import ActivityDetailDrawer from '../../components/activities/ActivityDetailDrawer.jsx'
import EditActivityModal from '../../components/activities/EditActivityModal.jsx'
import DeleteActivityModal from '../../components/activities/DeleteActivityModal.jsx'
import AssignSectionsModal from '../../components/activities/AssignSectionsModal.jsx'
import AddActivityModal from '../../components/activities/AddActivityModal.jsx'
import { Search, Plus, ClipboardList, CalendarDays, CalendarCheck, XCircle, CheckCircle2 } from 'lucide-react'

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
  const [isAddActivityOpen, setIsAddActivityOpen] = useState(false)
  const [selectedActivityForDrawer, setSelectedActivityForDrawer] = useState(null)
  const [editingActivityId, setEditingActivityId] = useState(null)
  const [selectedActivity, setSelectedActivity] = useState(null)
  const [deletingActivity, setDeletingActivity] = useState(null)
  const [isAssignSectionsModalOpen, setIsAssignSectionsModalOpen] = useState(false)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [pendingActivity, setPendingActivity] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const [activityTypeFilter, setActivityTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [assignedSectionFilter, setAssignedSectionFilter] = useState('')
  const [assignedInstructorFilter, setAssignedInstructorFilter] = useState('')
  const [sortBy, setSortBy] = useState('newest')

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

  const showToast = (message) => {
    setToastMessage(message)
    window.clearTimeout(showToast._timer)
    showToast._timer = window.setTimeout(() => setToastMessage(''), 4000)
  }

  const handleActivityCreated = (savedActivity) => {
    if (!savedActivity || !savedActivity.id) {
      fetchActivities()
      return
    }

    setActivities((existingActivities) => [savedActivity, ...existingActivities])
    showToast('Activity created successfully.')
    setIsAddActivityOpen(false)
  }

  const handleActivitySaved = (savedActivity) => {
    if (!savedActivity || !savedActivity.id) {
      fetchActivities()
      return
    }

    setActivities((existingActivities) => {
      return existingActivities.map((activity) => (activity.id === savedActivity.id ? savedActivity : activity))
    })

    showToast('Activity updated successfully.')
    setIsEditModalOpen(false)
    setEditingActivityId(null)
    setSelectedActivity(null)
  }

  const handleActivityDeleted = async (deletedActivityId) => {
    setActivities((existingActivities) => existingActivities.filter((activity) => activity.id !== deletedActivityId))
    showToast('Activity deleted successfully.')
    setIsDeleteModalOpen(false)
    setDeletingActivity(null)
    setIsEditModalOpen(false)
    setEditingActivityId(null)
    setSelectedActivity(null)

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

  const navigate = useNavigate()

  const handleOpenDeleteModal = (row) => {
    setDeletingActivity(row)
    setIsDeleteModalOpen(true)
  }

  const handleDuplicateActivity = async (row) => {
    if (!row?.id) return

    try {
      const detailResponse = await api.get(`/activities/${row.id}/`)
      const source = detailResponse.data || {}
      const duplicatePayload = {
        title: `${source.title || row.title || 'Untitled Activity'} (Copy)`,
        description: source.description || row.description || '',
        instructions: source.instructions || '',
        activity_type: source.activity_type || row.activity_type || row.type || 'Assignment',
        due_date: source.due_date || row.due_date || '',
        max_score: source.max_score ?? row.max_score ?? 100,
        allow_resubmission: Boolean(source.allow_resubmission ?? row.allow_resubmission),
        section: source.section ?? row.section ?? null,
        assigned_sections: Array.isArray(source.assigned_sections) ? source.assigned_sections.map((section) => typeof section === 'object' ? section.id : section) : (Array.isArray(row.assigned_sections) ? row.assigned_sections : []),
        assigned_instructor: source.assigned_instructor ?? row.assigned_instructor ?? null,
        cabinet_station: source.cabinet_station || row.cabinet_station || '',
        status: source.status || row.status || 'Published',
      }

      const response = await api.post('/activities/', duplicatePayload)
      const createdActivity = response.data || {}
      setActivities((existingActivities) => [createdActivity, ...existingActivities])
      setEditingActivityId(createdActivity.id)
      setSelectedActivity(createdActivity)
      setIsEditModalOpen(true)
      showToast('Activity duplicated. You can edit the copy now.')
    } catch (err) {
      console.error('Failed to duplicate activity', err)
      showToast('Unable to duplicate activity right now.')
    }
  }

  const handleConfirmAction = async () => {
    if (!pendingActivity?.id || !pendingAction) return

    try {
      const nextStatus = pendingAction === 'close' ? 'Closed' : 'Archived'
      const response = await api.patch(`/activities/${pendingActivity.id}/`, { status: nextStatus })
      const updatedActivity = response.data || { ...pendingActivity, status: nextStatus }
      setActivities((existingActivities) => existingActivities.map((activity) => (activity.id === pendingActivity.id ? updatedActivity : activity)))
      showToast(`Activity ${pendingAction === 'close' ? 'closed' : 'archived'} successfully.`)
    } catch (err) {
      console.error('Failed to update activity status', err)
      showToast('Unable to update the activity status right now.')
    } finally {
      setIsConfirmModalOpen(false)
      setPendingAction(null)
      setPendingActivity(null)
    }
  }

  const handleRowAction = (action, row) => {
    if (!row) return
    switch (action) {
      case 'view':
        setSelectedActivityForDrawer(row)
        break
      case 'edit':
        handleOpenEditModal(row.id, row)
        break
      case 'duplicate':
        handleDuplicateActivity(row)
        break
      case 'assign_sections':
        setPendingActivity(row)
        setIsAssignSectionsModalOpen(true)
        break
      case 'view_submissions':
        navigate(`/admin/submissions?activity=${row.id}`)
        break
      case 'close':
        setPendingAction('close')
        setPendingActivity(row)
        setIsConfirmModalOpen(true)
        break
      case 'archive':
        setPendingAction('archive')
        setPendingActivity(row)
        setIsConfirmModalOpen(true)
        break
      case 'delete':
        handleOpenDeleteModal(row)
        break
      default:
        break
    }
  }

  const activityTypeOptions = useMemo(
    () => Array.from(new Set(activities.map((activity) => (activity.activity_type || activity.type || '').trim()).filter(Boolean))).sort(),
    [activities],
  )

  const sectionOptions = useMemo(
    () => Array.from(new Set(activities.map((activity) => (activity.section_name || activity.section || '').trim()).filter(Boolean))).sort(),
    [activities],
  )

  const instructorOptions = useMemo(
    () => Array.from(
      new Set(
        activities
          .map((activity) => (activity.instructor_name || `${activity.created_by_name || ''} ${activity.created_by_last_name || ''}`.trim()).trim())
          .filter(Boolean),
      ),
    ).sort(),
    [activities],
  )

  const filteredActivities = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const keywordFiltered = activities.filter((activity) => {
      const searchable = [activity.title, activity.description, activity.activity_type, activity.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
      if (keyword && !searchable) return false

      if (activityTypeFilter) {
        const activityType = String(activity.activity_type || activity.type || '').toLowerCase()
        if (activityType !== activityTypeFilter.toLowerCase()) return false
      }

      if (statusFilter) {
        const statusValue = String(activity.status || '').toLowerCase()
        if (statusValue !== statusFilter.toLowerCase()) return false
      }

      if (assignedSectionFilter) {
        const sectionValue = String(activity.section_name || activity.section || '').toLowerCase()
        if (sectionValue !== assignedSectionFilter.toLowerCase()) return false
      }

      if (assignedInstructorFilter) {
        const instructorValue = String(activity.instructor_name || `${activity.created_by_name || ''} ${activity.created_by_last_name || ''}`.trim()).toLowerCase()
        if (instructorValue !== assignedInstructorFilter.toLowerCase()) return false
      }

      return true
    })

    return [...keywordFiltered].sort((a, b) => {
      const lower = sortBy === 'oldest' || sortBy === 'newest'
      const dateA = new Date(a.created_at || a.due_date || 0).getTime() || 0
      const dateB = new Date(b.created_at || b.due_date || 0).getTime() || 0

      if (sortBy === 'newest') return dateB - dateA
      if (sortBy === 'oldest') return dateA - dateB
      if (sortBy === 'due_date') {
        const dueA = new Date(a.due_date || 0).getTime() || 0
        const dueB = new Date(b.due_date || 0).getTime() || 0
        return dueA - dueB
      }
      if (sortBy === 'alphabetical') {
        return String(a.title || '').localeCompare(String(b.title || ''))
      }
      return 0
    })
  }, [activities, query, activityTypeFilter, statusFilter, assignedSectionFilter, assignedInstructorFilter, sortBy])

  const totalActivities = activities.length

  const activeActivities = activities.filter((activity) => {
    if (typeof activity.is_active !== 'undefined') return activity.is_active
    if (typeof activity.status !== 'undefined') return String(activity.status).toLowerCase() === 'active'
    return true
  }).length

  const dueTodayActivities = activities.filter((activity) => {
    const dueDate = activity.due_date ? new Date(activity.due_date) : null
    if (!dueDate || Number.isNaN(dueDate.getTime())) return false
    const today = new Date()
    return (
      dueDate.getFullYear() === today.getFullYear() &&
      dueDate.getMonth() === today.getMonth() &&
      dueDate.getDate() === today.getDate()
    )
  }).length

  const closedActivities = activities.filter((activity) => {
    if (typeof activity.is_active !== 'undefined' && activity.is_active === false) return true
    if (typeof activity.status !== 'undefined') {
      const status = String(activity.status).toLowerCase()
      if (['closed', 'expired', 'completed'].includes(status)) return true
    }

    const dueDate = activity.due_date ? new Date(activity.due_date) : null
    if (dueDate && !Number.isNaN(dueDate.getTime())) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (dueDate < today) return true
    }

    return false
  }).length

  const getActivityType = (row) => {
    return row.activity_type || row.type || '—'
  }

  const getActivityStatus = (row) => {
    const rawStatus = typeof row.status === 'string' ? row.status : ''
    if (rawStatus) {
      const normalized = rawStatus.trim().toLowerCase()
      if (['active', 'published'].includes(normalized)) return 'Active'
      if (['draft'].includes(normalized)) return 'Draft'
      if (['scheduled'].includes(normalized)) return 'Scheduled'
      if (['closed', 'expired', 'completed'].includes(normalized)) return 'Closed'
      if (['archived'].includes(normalized)) return 'Archived'
      return rawStatus
    }
    if (typeof row.is_active !== 'undefined') {
      return row.is_active ? 'Active' : 'Closed'
    }
    return 'Active'
  }

  const getStatusBadge = (row) => {
    const status = String(getActivityStatus(row)).trim().toLowerCase()
    const badgeMap = {
      active: { label: 'Active', color: 'bg-[#ECFDF3] text-[#16A34A]' },
      published: { label: 'Active', color: 'bg-[#ECFDF3] text-[#16A34A]' },
      scheduled: { label: 'Scheduled', color: 'bg-[#FEF3C7] text-[#92400E]' },
      draft: { label: 'Draft', color: 'bg-[#DBEAFE] text-[#1D4ED8]' },
      archived: { label: 'Archived', color: 'bg-[#F3E8FF] text-[#6D28D9]' },
      closed: { label: 'Closed', color: 'bg-[#FEE2E2] text-[#B91C1C]' },
      expired: { label: 'Closed', color: 'bg-[#FEE2E2] text-[#B91C1C]' },
      completed: { label: 'Closed', color: 'bg-[#FEE2E2] text-[#B91C1C]' },
    }

    const badge = badgeMap[status] || badgeMap.active
    return (
      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badge.color}`}>
        {badge.label}
      </span>
    )
  }

  const getSubmissionCount = (row) => {
    if (typeof row.submissions_count === 'number') return row.submissions_count
    if (typeof row.submission_count === 'number') return row.submission_count
    if (typeof row.total_submissions === 'number') return row.total_submissions
    if (Array.isArray(row.submissions)) return row.submissions.length
    return 0
  }

  const getSubmittedStudentCount = (row) => {
    if (typeof row.submitted_students_count === 'number') return row.submitted_students_count
    return getSubmissionCount(row)
  }

  const getAssignedStudentCount = (row) => {
    if (typeof row.assigned_student_count === 'number') return row.assigned_student_count
    if (typeof row.section_student_count === 'number') return row.section_student_count
    if (row.section && typeof row.section.student_count === 'number') return row.section.student_count
    return 0
  }

  const getSubmissionCompletionPercent = (row) => {
    const assigned = getAssignedStudentCount(row)
    if (!assigned) return 0
    const submitted = getSubmittedStudentCount(row)
    return Math.min(100, Math.max(0, Math.round((submitted / assigned) * 100)))
  }

  const renderSubmissionProgress = (row) => {
    const submitted = getSubmittedStudentCount(row)
    const assigned = getAssignedStudentCount(row)
    const percent = getSubmissionCompletionPercent(row)

    return (
      <div className="min-w-[180px] space-y-2">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-900">
          <span>{submitted} / {assigned || '—'}</span>
          <span className="text-xs font-medium text-slate-500">{percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-[#2563EB] transition-all duration-200" style={{ width: `${percent}%` }} />
        </div>
      </div>
    )
  }

  const columns = [
    {
      key: 'activity',
      label: 'Activity',
      className: 'min-w-[260px] max-w-[320px]',
      render: (_value, row) => (
        <div className="flex flex-col">
          <span className="font-semibold text-[#111827]">{row.title || '—'}</span>
          <span className="text-sm text-[#6B7280]">{getActivityType(row)}</span>
        </div>
      ),
    },
    {
      key: 'section',
      label: 'Section',
      className: 'min-w-[180px]',
      render: (_value, row) => row.section_name || row.section || '—',
    },
    {
      key: 'instructor',
      label: 'Instructor',
      className: 'min-w-[180px]',
      render: (_value, row) => row.instructor_name || `${row.created_by_name || ''} ${row.created_by_last_name || ''}`.trim() || '—',
    },
    {
      key: 'due_date',
      label: 'Due Date',
      className: 'min-w-[160px]',
      render: (value) => formatDate(value),
    },
    {
      key: 'status',
      label: 'Status',
      className: 'min-w-[140px]',
      render: (_value, row) => getStatusBadge(row),
    },
    {
      key: 'submission_progress',
      label: 'Submission Progress',
      className: 'min-w-[220px]',
      render: (_value, row) => renderSubmissionProgress(row),
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[140px]',
      render: (_value, row) => <ActivityActionsMenu activity={row} onAction={handleRowAction} />,
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Activities Management"
        description="Browse and search system activities."
      />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<ClipboardList size={18} />} label="Total Activities" value={totalActivities} subtitle="All recorded activities" />
        <StatCard icon={<CalendarDays size={18} />} label="Active Activities" value={activeActivities} subtitle="Currently open" />
        <StatCard icon={<CalendarCheck size={18} />} label="Due Today" value={dueTodayActivities} subtitle="Scheduled for today" />
        <StatCard icon={<XCircle size={18} />} label="Closed Activities" value={closedActivities} subtitle="Closed or expired" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Activity Directory</h2>
            <p className="text-sm text-[#6B7280]">Browse activities, their status, and submission progress.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={() => setIsAddActivityOpen(true)} className="flex items-center justify-center gap-2 rounded-[10px] bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1D4ED8]">
              <Plus size={16} />
              Create Activity
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-[360px]">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6B7280]">
              <Search size={16} />
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search activities..."
              className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white pl-10 pr-3 text-sm text-[#374151] outline-none transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15"
            />
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select value={activityTypeFilter} onChange={(event) => setActivityTypeFilter(event.target.value)} className="h-11 min-w-[180px] rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
              <option value="">All activity types</option>
              {activityTypeOptions.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 min-w-[180px] rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
              <option value="">All statuses</option>
              <option value="Active">Active</option>
              <option value="Draft">Draft</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Closed">Closed</option>
              <option value="Archived">Archived</option>
            </select>
            <select value={assignedSectionFilter} onChange={(event) => setAssignedSectionFilter(event.target.value)} className="h-11 min-w-[180px] rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
              <option value="">All assigned sections</option>
              {sectionOptions.map((section) => (
                <option key={section} value={section}>{section}</option>
              ))}
            </select>
            <select value={assignedInstructorFilter} onChange={(event) => setAssignedInstructorFilter(event.target.value)} className="h-11 min-w-[180px] rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
              <option value="">All instructors</option>
              {instructorOptions.map((instructor) => (
                <option key={instructor} value={instructor}>{instructor}</option>
              ))}
            </select>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="h-11 min-w-[180px] rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="due_date">Due Date</option>
              <option value="alphabetical">Alphabetical</option>
            </select>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
          <div />
          <div>{filteredActivities.length} result{filteredActivities.length === 1 ? '' : 's'}</div>
        </div>

        <DataTable columns={columns} data={filteredActivities} loading={loading} showActions={false} emptyMessage={activities.length ? 'No activities match your filters.' : 'No activities available.'} />
      </div>

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-[14px] border border-[#D1FAE5] bg-[#ECFDF5] px-5 py-4 text-sm text-[#065F46] shadow-lg">
          {toastMessage}
        </div>
      )}

      <AddActivityModal
        isOpen={isAddActivityOpen}
        onClose={() => setIsAddActivityOpen(false)}
        onUnauthorized={() => setIsAddActivityOpen(false)}
        onSaved={handleActivityCreated}
      />

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

      <AssignSectionsModal
        isOpen={isAssignSectionsModalOpen}
        activity={pendingActivity}
        onClose={() => {
          setIsAssignSectionsModalOpen(false)
          setPendingActivity(null)
        }}
        onSaved={(updatedActivity) => {
          setActivities((existingActivities) => existingActivities.map((activity) => (activity.id === updatedActivity.id ? updatedActivity : activity)))
          showToast('Sections updated successfully.')
        }}
        onUnauthorized={() => {
          setIsAssignSectionsModalOpen(false)
          setPendingActivity(null)
        }}
      />

      <Modal isOpen={isConfirmModalOpen} onClose={() => {
        setIsConfirmModalOpen(false)
        setPendingAction(null)
        setPendingActivity(null)
      }} title={pendingAction === 'close' ? 'Close Activity' : 'Archive Activity'}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {pendingAction === 'close'
              ? 'This will mark the selected activity as closed. Continue?'
              : 'This will archive the selected activity. Continue?'}
          </p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => {
              setIsConfirmModalOpen(false)
              setPendingAction(null)
              setPendingActivity(null)
            }} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
              Cancel
            </button>
            <button type="button" onClick={handleConfirmAction} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              Confirm
            </button>
          </div>
        </div>
      </Modal>

      <ActivityDetailDrawer
        activity={selectedActivityForDrawer}
        onClose={() => setSelectedActivityForDrawer(null)}
      />
    </div>
  )
}
