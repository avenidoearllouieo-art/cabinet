import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import TableSkeleton from '../../components/TableSkeleton'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/StatusBadge'
import Modal from '../../components/Modal.jsx'
import ActivityActionsMenu from '../../components/activities/ActivityActionsMenu.jsx'
import ActivityDetailDrawer from '../../components/activities/ActivityDetailDrawer.jsx'
import EditActivityModal from '../../components/activities/EditActivityModal.jsx'
import DeleteActivityModal from '../../components/activities/DeleteActivityModal.jsx'
import AssignSectionsModal from '../../components/activities/AssignSectionsModal.jsx'
import AddActivityModal from '../../components/activities/AddActivityModal.jsx'
import { fetchAllResults } from '../../services/paginatedResults.js'
import Pagination from '../../components/Pagination.jsx'
import { Search, Plus, ClipboardList, CalendarDays, CalendarCheck, XCircle, SlidersHorizontal, X } from 'lucide-react'

const formatDate = (value) => {
  try {
    return new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

const getActivityStatus = (row) => {
  const rawStatus = typeof row.status === 'string' ? row.status.trim() : ''
  if (rawStatus) {
    const normalized = rawStatus.toLowerCase()
    if (['active', 'published'].includes(normalized)) return 'Active'
    if (normalized === 'draft') return 'Draft'
    if (normalized === 'scheduled') return 'Scheduled'
    if (['closed', 'expired', 'completed'].includes(normalized)) return 'Closed'
    if (normalized === 'archived') return 'Archived'
    return rawStatus
  }
  if (typeof row.is_active === 'boolean') return row.is_active ? 'Active' : 'Closed'
  return 'Active'
}

const getActivitySectionNames = (activity) => {
  const sections = Array.isArray(activity.assigned_sections) ? activity.assigned_sections : []
  const names = sections.map((section) => typeof section === 'object'
    ? section.section_name || section.name || section.subject_code
    : null).filter(Boolean)
  if (!names.length && (activity.section_name || typeof activity.section === 'string')) names.push(activity.section_name || activity.section)
  return names
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
  const [page, setPage] = useState(1)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const pageSize = 10

  useEffect(() => {
    // expose a global helper so Edit buttons rendered by DataTable can open the modal
    window.openEditActivityModal = (id, row) => {
      if (!id) return
      setEditingActivityId(id)
      setSelectedActivity(row || null)
      setIsEditModalOpen(true)
    }
    return () => { delete window.openEditActivityModal }
  }, [])

  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true)
      const { results } = await fetchAllResults(api, '/activities/')
      setActivities(results)
      setPage(1)
      setError('')
    } catch (err) {
      console.error('Error fetching activities:', err)
      setError('Failed to load activities.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchActivities, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchActivities])

  const showToast = (message) => {
    setToastMessage(message)
    window.clearTimeout(showToast._timer)
    showToast._timer = window.setTimeout(() => setToastMessage(''), 4000)
  }

  const handleActivityCreated = (savedActivity) => {
    if (!savedActivity || !savedActivity.id) {
      void fetchActivities()
      return
    }

    setActivities((existingActivities) => [savedActivity, ...existingActivities.filter((activity) => activity.id !== savedActivity.id)])
    void fetchActivities()
    showToast('Activity created successfully.')
    setIsAddActivityOpen(false)
  }

  const handleActivitySaved = (savedActivity) => {
    if (!savedActivity || !savedActivity.id) {
      void fetchActivities()
      return
    }

    setActivities((existingActivities) => existingActivities.map((activity) => activity.id === savedActivity.id ? savedActivity : activity))
    void fetchActivities()

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

  const handleCloseActivityDrawer = useCallback(() => {
    setSelectedActivityForDrawer(null)
  }, [])

  const handleConfirmAction = async () => {
    if (!pendingActivity?.id || !pendingAction) return

    setActionBusy(true)
    setActionError('')
    try {
      if (pendingAction === 'duplicate') {
        const detailResponse = await api.get(`/activities/${pendingActivity.id}/`)
        const source = detailResponse.data || pendingActivity
        const baseTitle = source.title || pendingActivity.title || 'Untitled Activity'
        const payload = {
          title: `${baseTitle.slice(0, 193)} (Copy)`,
          description: source.description || '',
          instructions: source.instructions || '',
          activity_type: source.activity_type || 'Assignment',
          due_date: null,
          max_score: source.max_score ?? 100,
          allow_resubmission: Boolean(source.allow_resubmission),
          section: source.section ?? (source.assigned_sections?.[0]?.id || source.assigned_sections?.[0] || null),
          assigned_sections: Array.isArray(source.assigned_sections) ? source.assigned_sections.map((section) => typeof section === 'object' ? section.id : section) : [],
          assigned_instructor: source.assigned_instructor ?? null,
          cabinet_station: source.cabinet_station || '',
          status: 'Draft',
        }
        const response = await api.post('/activities/', payload)
        const createdActivity = response.data || {}
        await fetchActivities()
        setEditingActivityId(createdActivity.id)
        setSelectedActivity(createdActivity)
        setIsEditModalOpen(true)
        showToast('Draft copy created. Review its sections and deadline before publishing.')
      } else {
        const nextStatus = pendingAction === 'close' ? 'Closed' : 'Archived'
        const response = await api.patch(`/activities/${pendingActivity.id}/`, { status: nextStatus })
        const updatedActivity = response.data || { ...pendingActivity, status: nextStatus }
        setActivities((existingActivities) => existingActivities.map((activity) => (activity.id === pendingActivity.id ? updatedActivity : activity)))
        showToast(`Activity ${pendingAction === 'close' ? 'closed' : 'archived'} successfully.`)
      }
      finishPendingAction()
    } catch (err) {
      console.error('Failed to update activity status', err)
      setActionError(err.response?.data?.detail || 'The activity action failed. Try again.')
    } finally {
      setActionBusy(false)
    }
  }

  const closePendingAction = () => {
    if (actionBusy) return
    setIsConfirmModalOpen(false)
    setPendingAction(null)
    setPendingActivity(null)
    setActionError('')
  }

  const finishPendingAction = () => {
      setIsConfirmModalOpen(false)
      setPendingAction(null)
      setPendingActivity(null)
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
        setActionError('')
        setPendingAction('duplicate')
        setPendingActivity(row)
        setIsConfirmModalOpen(true)
        break
      case 'assign_sections':
        setPendingActivity(row)
        setIsAssignSectionsModalOpen(true)
        break
      case 'view_submissions':
        navigate(`/admin/submissions?activity=${row.id}`)
        break
      case 'close':
        if (!['active', 'published', 'scheduled'].includes(String(row.status || 'published').toLowerCase())) break
        setActionError('')
        setPendingAction('close')
        setPendingActivity(row)
        setIsConfirmModalOpen(true)
        break
      case 'archive':
        if (String(row.status || '').toLowerCase() === 'archived') break
        setActionError('')
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

  const filteredActivities = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const keywordFiltered = activities.filter((activity) => {
      const assignedInstructor = activity.assigned_instructor_name || activity.instructor_name || `${activity.created_by_name || ''} ${activity.created_by_last_name || ''}`.trim()
      const searchable = [activity.title, activity.description, activity.instructions, activity.activity_type, activity.type, assignedInstructor, ...getActivitySectionNames(activity)]
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
        if (!getActivitySectionNames(activity).some((section) => section.toLowerCase() === assignedSectionFilter.toLowerCase())) return false
      }

      if (assignedInstructorFilter) {
        const instructorValue = String(activity.instructor_name || `${activity.created_by_name || ''} ${activity.created_by_last_name || ''}`.trim()).toLowerCase()
        if (instructorValue !== assignedInstructorFilter.toLowerCase()) return false
      }

      return true
    })

    return [...keywordFiltered].sort((a, b) => {
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

  const activityTypes = [...new Set(activities.map((activity) => activity.activity_type || activity.type).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
  const activitySections = [...new Set(activities.flatMap(getActivitySectionNames))].sort((a, b) => a.localeCompare(b))
  const activityInstructors = [...new Set(activities.map((activity) => activity.assigned_instructor_name || activity.instructor_name || `${activity.created_by_name || ''} ${activity.created_by_last_name || ''}`.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const pageCount = Math.max(1, Math.ceil(filteredActivities.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleActivities = filteredActivities.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const totalActivities = activities.length

  const activeActivities = activities.filter((activity) => getActivityStatus(activity) === 'Active').length

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

  const closedActivities = activities.filter((activity) => getActivityStatus(activity) === 'Closed').length

  const getActivityType = (row) => {
    return row.activity_type || row.type || '—'
  }

  const getStatusBadge = (row) => {
    const status = getActivityStatus(row)
    return <StatusBadge status={status} label={status} />
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

  const columns = [
    {
      key: 'activity',
      label: 'Activity',
      className: 'w-[22%]',
      render: (_value, row) => (
        <div className="flex flex-col">
          <span className="font-semibold text-[#111827]">{row.title || '—'}</span>
          <span className="text-sm text-[#6B7280]">{getActivityType(row)}</span>
        </div>
      ),
    },
    {
      key: 'section',
      label: 'Assigned Sections',
      className: 'w-[16%]',
      render: (_value, row) => getActivitySectionNames(row).join(', ') || '—',
    },
    {
      key: 'created_by',
      label: 'Created By',
      className: 'w-[13%]',
      render: (_value, row) => row.instructor_name || `${row.created_by_name || ''} ${row.created_by_last_name || ''}`.trim() || '—',
    },
    {
      key: 'due_date',
      label: 'Due Date',
      className: 'w-[14%]',
      render: (value) => formatDate(value),
    },
    {
      key: 'status',
      label: 'Status',
      className: 'w-[11%]',
      render: (_value, row) => getStatusBadge(row),
    },
    {
      key: 'submissions',
      label: 'Submissions',
      className: 'w-[13%]',
      render: (_value, row) => {
        const submitted = getSubmittedStudentCount(row)
        const assigned = Number(row.assigned_student_count)
        return <span className="font-medium">{submitted}{assigned > 0 ? ` / ${assigned}` : ' submitted'}</span>
      },
    },
    {
      key: 'actions',
      label: 'Action',
      className: 'w-[10%]',
      render: (_value, row) => <ActivityActionsMenu activity={row} onAction={handleRowAction} />,
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Activities Management"
        description="Browse and search system activities."
        action={<button type="button" onClick={() => setIsAddActivityOpen(true)} className="tt-button tt-button-primary w-full sm:w-auto"><Plus size={16} aria-hidden="true" />Create Activity</button>}
      />

      <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
        <SummaryCard icon={ClipboardList} title="Total Activities" value={totalActivities} trendText="All recorded activities" iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={CalendarDays} title="Active Activities" value={activeActivities} trendText="Currently open" iconBg="bg-emerald-50" iconColor="text-emerald-900" />
        <SummaryCard icon={CalendarCheck} title="Due Today" value={dueTodayActivities} trendText="Scheduled for today" iconBg="bg-amber-50" iconColor="text-amber-900" />
        <SummaryCard icon={XCircle} title="Closed Activities" value={closedActivities} trendText="Closed or expired" iconBg="bg-slate-100" iconColor="text-slate-700" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <section className="min-w-0 rounded-[12px] border border-[#E5E7EB] bg-white p-3 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#102a4c]">Activity Directory</h2>
            <p className="text-sm text-[#64748b]">Browse activities, assignment, deadlines, and submission progress.</p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-3">
          <label className="relative block w-full">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#64748b]"><Search size={16} /></span>
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Search title, description, instructor, or section" aria-label="Search activities" className="tt-control w-full pl-10 pr-10" />
            {query && <button type="button" onClick={() => { setQuery(''); setPage(1) }} aria-label="Clear activity search" className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><X size={16} /></button>}
          </label>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <label className="min-w-0">
              <span className="sr-only">Filter activity status</span>
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="tt-control w-full">
                <option value="">All statuses</option>
                <option value="Active">Active</option><option value="Draft">Draft</option><option value="Scheduled">Scheduled</option><option value="Closed">Closed</option><option value="Archived">Archived</option>
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">Filter activity type</span>
              <select value={activityTypeFilter} onChange={(event) => { setActivityTypeFilter(event.target.value); setPage(1) }} className="tt-control w-full">
                <option value="">All activity types</option>{activityTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">Filter assigned section</span>
              <select value={assignedSectionFilter} onChange={(event) => { setAssignedSectionFilter(event.target.value); setPage(1) }} className="tt-control w-full">
                <option value="">All sections</option>{activitySections.map((section) => <option key={section} value={section}>{section}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">Filter instructor</span>
              <select value={assignedInstructorFilter} onChange={(event) => { setAssignedInstructorFilter(event.target.value); setPage(1) }} className="tt-control w-full">
                <option value="">All instructors</option>{activityInstructors.map((instructor) => <option key={instructor} value={instructor}>{instructor}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">Sort activities</span>
              <select value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1) }} className="tt-control w-full">
                <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="due_date">Due date</option><option value="alphabetical">Title</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between gap-3 text-sm text-slate-500">
          <span className="inline-flex items-center gap-2"><SlidersHorizontal size={15} />{filteredActivities.length} result{filteredActivities.length === 1 ? '' : 's'}</span>
          {statusFilter || activityTypeFilter || assignedSectionFilter || assignedInstructorFilter || query ? <button type="button" onClick={() => { setQuery(''); setStatusFilter(''); setActivityTypeFilter(''); setAssignedSectionFilter(''); setAssignedInstructorFilter(''); setPage(1) }} className="min-h-9 text-xs font-semibold text-[#1d5b91] hover:underline">Clear filters</button> : null}
        </div>

        {loading ? (
          <TableSkeleton />
        ) : (
          <DataTable
            columns={columns}
            data={visibleActivities}
            showActions={false}
            expandable
            variant="admin"
            constrainTableHeight={false}
            renderMobileCard={(row, { expanded, toggleExpanded }) => {
              const sections = getActivitySectionNames(row)
              const submitted = getSubmittedStudentCount(row)
              const assigned = Number(row.assigned_student_count)
              const progress = assigned > 0 ? Math.min(100, Math.round((submitted / assigned) * 100)) : null
              return (
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-semibold text-[#102a4c]">{row.title || 'Untitled Activity'}</h3>
                      <p className="mt-0.5 break-words text-xs text-slate-500">{getActivityType(row)}</p>
                    </div>
                    <ActivityActionsMenu activity={row} onAction={handleRowAction} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">{getStatusBadge(row)}</div>
                  <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-xs">
                    <dt className="text-slate-500">Sections</dt><dd className="break-words text-right text-slate-700">{sections.join(', ') || row.section_name || 'Not assigned'}</dd>
                    <dt className="text-slate-500">Instructor</dt><dd className="break-words text-right text-slate-700">{row.assigned_instructor_name || row.instructor_name || `${row.created_by_name || ''} ${row.created_by_last_name || ''}`.trim() || '—'}</dd>
                    <dt className="text-slate-500">Due date</dt><dd className="break-words text-right text-slate-700">{formatDate(row.due_date)}</dd>
                    <dt className="text-slate-500">Submissions</dt><dd className="text-right font-medium text-slate-700">{submitted}{assigned > 0 ? ` / ${assigned}` : ''}</dd>
                  </dl>
                  {progress !== null && <div className="mt-2"><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#FFC107]" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-right text-[10px] text-slate-500">{progress}% submitted</p></div>}
                  <button type="button" aria-expanded={expanded} onClick={toggleExpanded} className="mt-2 min-h-9 text-xs font-semibold text-[#1d5b91] hover:underline">{expanded ? 'Hide details' : 'More details'}</button>
                  {expanded && <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 text-xs"><p className="whitespace-pre-wrap break-words"><strong>Description:</strong> {row.description || '—'}</p><p className="whitespace-pre-wrap break-words"><strong>Instructions:</strong> {row.instructions || '—'}</p><p><strong>Cabinet station:</strong> {row.cabinet_station || '—'}</p></div>}
                </div>
              )
            }}
            renderExpandedRow={(row) => (
              <dl className="grid gap-2 sm:grid-cols-2">
                <div><dt className="font-semibold">Activity Type</dt><dd>{getActivityType(row)}</dd></div>
                <div><dt className="font-semibold">Assigned Instructor</dt><dd>{row.assigned_instructor_name || row.instructor_name || `${row.created_by_name || ''} ${row.created_by_last_name || ''}`.trim() || '—'}</dd></div>
                <div><dt className="font-semibold">Cabinet Station</dt><dd>{row.cabinet_station || '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="font-semibold">Description</dt><dd className="whitespace-pre-wrap">{row.description || '—'}</dd></div>
              </dl>
            )}
            emptyMessage={activities.length ? 'No activities match your filters.' : 'No activities available.'}
          />
        )}
        {!loading && pageCount > 1 && <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} label="Page" />}
      </section>

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

      <Modal
        isOpen={isConfirmModalOpen}
        onClose={closePendingAction}
        title={pendingAction === 'duplicate' ? 'Duplicate Activity' : pendingAction === 'close' ? 'Close Activity' : 'Archive Activity'}
        description={pendingActivity?.title || 'Selected activity'}
        busy={actionBusy}
        maxWidth="520px"
        footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={closePendingAction} disabled={actionBusy} className="tt-button tt-button-secondary w-full sm:w-auto">Cancel</button><button type="button" onClick={handleConfirmAction} disabled={actionBusy} className="tt-button tt-button-primary w-full sm:w-auto">{actionBusy ? 'Working…' : pendingAction === 'duplicate' ? 'Create Draft Copy' : pendingAction === 'close' ? 'Close Activity' : 'Archive Activity'}</button></div>}
      >
        <div className="space-y-3 text-sm leading-6 text-slate-700">
          {actionError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
          {pendingAction === 'duplicate' ? (
            <><p>A new Draft copy will be created from <strong>{pendingActivity?.title || 'this activity'}</strong>.</p><p>The copy will not include submissions, grades, feedback, or attached files. Its due date will be cleared for review.</p></>
          ) : pendingAction === 'close' ? (
            <p>This marks <strong>{pendingActivity?.title || 'this activity'}</strong> as Closed. Existing submissions and grades remain unchanged.</p>
          ) : (
            <p>This marks <strong>{pendingActivity?.title || 'this activity'}</strong> as Archived. Existing submissions and grades remain unchanged.</p>
          )}
        </div>
      </Modal>

      <ActivityDetailDrawer
        activity={selectedActivityForDrawer}
        onClose={handleCloseActivityDrawer}
        onEdit={() => { handleOpenEditModal(selectedActivityForDrawer?.id, selectedActivityForDrawer); handleCloseActivityDrawer() }}
        onViewSubmissions={() => { navigate(`/admin/submissions?activity=${selectedActivityForDrawer?.id}`); handleCloseActivityDrawer() }}
      />
    </div>
  )
}
