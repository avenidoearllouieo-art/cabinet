import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import StatusBadge from '../../components/StatusBadge'
import TableSkeleton from '../../components/TableSkeleton'
import DataTable from '../../components/DataTable'
import AddUserModal from '../../components/users/AddUserModal.jsx'
import EditUserModal from '../../components/users/EditUserModal.jsx'
import ActionsMenu from '../../components/users/ActionsMenu.jsx'
import UserDrawer from '../../components/users/UserDrawer.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import UserDetailsPanel from '../../components/users/UserDetailsPanel.jsx'
import AnchoredMenu from '../../components/users/AnchoredMenu.jsx'
import UserActionDialog from '../../components/users/UserActionDialog.jsx'
import SearchField from '../../components/SearchField.jsx'
import { pluralize } from '../../utils/labels.js'
import { Plus, Upload, CheckCircle2, CircleOff, FileText, FileSpreadsheet, ShieldCheck, Activity, UserCheck, ChevronLeft, ChevronRight, ChevronDown, Trash2, UserRoundCheck, UserRoundX } from 'lucide-react'
import UserImportWizard from '../../components/users/UserImportWizard.jsx'

export default function Users() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [isAddUserOpen, setIsAddUserOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [selectedRole, setSelectedRole] = useState('student')
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingUserId, setEditingUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const [toastType, setToastType] = useState('success')
  const [activeRole, setActiveRole] = useState('all')
  const [selectedIds, setSelectedIds] = useState([])
  const [drawerUser, setDrawerUser] = useState(null)
  const [filters, setFilters] = useState({ status: '', section: '' })
  const [page, setPage] = useState(1)
  const [pendingAction, setPendingAction] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [currentAdmin] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}') } catch { return {} }
  })
  const pageSize = 20
  const closeUserDrawer = useCallback(() => setDrawerUser(null), [])

  const handleOpenAddForRole = (role) => {
    setEditingUserId(null)
    setSelectedUser(null)
    setSelectedRole(role)
    setIsAddUserOpen(true)
  }

  const showToast = useCallback((message, type = 'success') => {
    setToastMessage(message)
    setToastType(type)
    window.setTimeout(() => {
      setToastMessage('')
      setToastType('success')
    }, 4000)
  }, [])

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true)
      const allUsers = []
      const visitedPages = new Set()
      let requestedPage = 1
      while (!visitedPages.has(requestedPage)) {
        visitedPages.add(requestedPage)
        const response = await api.get('/users/', { params: { page: requestedPage } })
        const rawUsers = Array.isArray(response.data) ? response.data : response.data.results || []
        allUsers.push(...rawUsers)
        if (Array.isArray(response.data) || !response.data.next) break
        const nextPage = Number(new URL(response.data.next, window.location.href).searchParams.get('page'))
        if (!Number.isInteger(nextPage) || nextPage < 1) break
        requestedPage = nextPage
      }

      const normalizedUsers = allUsers.map((user) => ({
        ...user,
        id: user?.id ?? user?.pk ?? user?.user_id ?? user?.uuid,
      }))
      setUsers(normalizedUsers)
      setPage(1)
      setError('')
    } catch (err) {
      console.error('Error fetching users:', err)
      setError('Failed to load users.')
      showToast('Failed to load users. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const handleUserSaved = (savedUser) => {
    if (!savedUser || !savedUser.id) {
      fetchUsers()
      return
    }

    setUsers((existingUsers) => {
      if (editingUserId) {
        return existingUsers.map((user) => (user.id === savedUser.id ? savedUser : user))
      }
      return [savedUser, ...existingUsers]
    })

    showToast(editingUserId ? 'User updated successfully.' : 'User created successfully.', 'success')
    setIsAddUserOpen(false)
    setIsEditModalOpen(false)
    setEditingUserId(null)
    setSelectedUser(null)
    void fetchUsers()
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchUsers, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchUsers])

  useEffect(() => {
    window.openEditModal = (id, row) => {
      if (!id) return
      setEditingUserId(id)
      setSelectedUser(row || null)
      setIsEditModalOpen(true)
    }
    return () => { delete window.openEditModal }
  }, [])

  const sectionOptions = Array.from(
    new Set(
      users
        .map((user) => user.section_name || user.section)
        .filter((value) => value)
    )
  ).sort()

  const assignedSectionOptions = Array.from(
    new Set(
      users.flatMap((user) => (user.assigned_sections || []).map((section) => section?.section_name || section?.section)).filter((value) => value)
    )
  ).sort()

  const filteredUsers = users.filter((user) => {
    const keyword = query.toLowerCase()
    const matchesQuery = [user.username, user.email, user.first_name, user.last_name, user.student_id, user.instructor_id, user.nfc_uid]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword))

    if (!matchesQuery) return false
    const role = String(user.role || '').toLowerCase()
    if (activeRole !== 'all' && !(activeRole === 'admin' ? ['admin', 'administrator'].includes(role) : role === activeRole)) return false
    if (filters.status) {
      const wantActive = filters.status === 'active'
      if ((user.is_active || false) !== wantActive) return false
    }
    if (filters.section) {
      const filterValue = String(filters.section).toLowerCase()
      if (activeRole === 'all') {
        if (String(user.role).toLowerCase() !== filterValue) return false
      } else if (activeRole === 'instructor') {
        const assignedSections = (user.assigned_sections || []).map((section) => String(section?.section_name || section?.section || '').toLowerCase())
        if (!assignedSections.includes(filterValue)) return false
      } else {
        const sectionValue = String(user.section_name || user.section || '').toLowerCase()
        if (sectionValue !== filterValue) return false
      }
    }
    return true
  })

  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const getUserId = (row) => row?.id ?? row?.pk ?? row?.user_id ?? row?.uuid

  const isProtectedAccount = (user) => {
    const userId = getUserId(user)
    const currentId = currentAdmin.id ?? currentAdmin.pk ?? currentAdmin.user_id
    const isSelf = (userId && currentId && String(userId) === String(currentId))
      || (user?.username && currentAdmin.username && user.username === currentAdmin.username)
    const isLastActiveAdmin = ['admin', 'administrator'].includes(String(user?.role || '').toLowerCase())
      && user?.is_active
      && users.filter((item) => ['admin', 'administrator'].includes(String(item.role || '').toLowerCase()) && item.is_active).length <= 1
    return Boolean(isSelf || isLastActiveAdmin)
  }

  const toggleUserSelection = (user) => {
    const id = getUserId(user)
    setSelectedIds((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id])
  }

  const selectVisibleUsers = () => {
    const visibleIds = visibleUsers.map(getUserId)
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
    setSelectedIds((current) => allSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])])
  }

  const statusBadge = (row) => <StatusBadge status={row.is_active ? 'active' : 'inactive'} icon={row.is_active ? CheckCircle2 : CircleOff} />

  const nfcStatusBadge = (user) => {
    const registered = typeof user?.nfc_registered === 'boolean' ? user.nfc_registered : Boolean(user?.nfc_uid)
    return <StatusBadge status={registered ? 'registered' : 'not assigned'} label={registered ? 'Registered' : 'Not Assigned'} />
  }

  const roleBadge = (role) => {
    const normalized = (role || '').toLowerCase()
    const label = normalized === 'administrator' || normalized === 'admin' ? 'Administrator' : normalized === 'instructor' ? 'Instructor' : normalized === 'student' ? 'Student' : role || 'Unknown'
    return <StatusBadge status={normalized} label={label} tone="info" />
  }

  const columns = [
    {
      key: 'selection',
      label: 'Select',
      className: 'w-12',
      render: (_value, row) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.username}`}
          checked={selectedIds.includes(getUserId(row))}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleUserSelection(row)}
          className="h-4 w-4 rounded border-slate-300 text-[#002B5B] focus:ring-[#FFC107]"
        />
      ),
    },
    {
      key: 'name',
      label: 'Full Name',
      className: 'w-[18%]',
      render: (_value, row) => {
        const name = `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.username || '—'
        return <div className="flex min-w-0 items-center gap-2"><UserAvatar user={row} size="xs" alt={`${name} profile picture`} /><span className="min-w-0 break-words font-semibold text-[#102a4c]">{name}</span></div>
      },
    },
    { key: 'username', label: 'Username', className: 'w-[11%]' },
    { key: 'email', label: 'Email', className: 'w-[20%]' },
    { key: 'role', label: 'Role', className: 'w-[10%]', render: (_v, row) => roleBadge(row.role) },
    { key: 'nfc_status', label: 'NFC Status', className: 'w-[11%]', render: (_v, row) => nfcStatusBadge(row) },
    { key: 'status', label: 'Account Status', className: 'w-[12%]', render: (_v, row) => statusBadge(row) },
    {
      key: 'actions',
      label: 'Action',
      className: 'w-[12%]',
      render: (_v, row) => (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => handleRowAction('view', row)} className="min-h-9 rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">View</button>
          <ActionsMenu user={row} onAction={handleRowAction} protectedAccount={isProtectedAccount(row)} />
        </div>
      ),
    },
  ]

  const totalUsers = users.length
  const totalStudents = users.filter((u) => u.role === 'student').length
  const totalInstructors = users.filter((u) => u.role === 'instructor').length
  const totalAdmins = users.filter((u) => ['admin', 'administrator'].includes(String(u.role || '').toLowerCase())).length
  const inactiveUsers = users.filter((user) => !user.is_active).length
  const activeStudents = users.filter((user) => user.role === 'student' && user.is_active).length
  const activeInstructors = users.filter((user) => user.role === 'instructor' && user.is_active).length
  const activeAdmins = users.filter((user) => ['admin', 'administrator'].includes(String(user.role || '').toLowerCase()) && user.is_active).length
  const selectedUsers = users.filter((user) => selectedIds.includes(getUserId(user)))
  const protectedSelection = selectedUsers.filter(isProtectedAccount)

  const bulkMenuItem = (action, label, Icon, disabled = false, danger = false) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled || actionBusy}
      onClick={() => {
        if (disabled || actionBusy) return
        handleBulkAction(action)
      }}
      className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#FFC107] disabled:cursor-not-allowed disabled:opacity-45 ${danger ? 'text-red-700 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}
    >
      <Icon size={16} aria-hidden="true" />{label}
    </button>
  )

  const roleTab = (value, label) => (
    <button
      key={value}
      type="button"
      aria-pressed={activeRole === value}
      onClick={() => { setActiveRole(value); setFilters((current) => ({ ...current, section: '' })); setPage(1) }}
      className={`min-h-9 rounded-md px-3 text-xs font-semibold transition sm:text-sm ${activeRole === value ? 'bg-[#FFC107] text-[#002B5B] shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-[#002B5B]'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        title="Users Management"
        description="Manage system users, roles, and permissions"
        action={
          <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 xl:w-auto xl:justify-end">
            <div className="flex max-w-full flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1" role="group" aria-label="Filter users by role">
              {roleTab('all', 'All Users')}
              {roleTab('student', 'Students')}
              {roleTab('instructor', 'Instructors')}
              {roleTab('admin', 'Administrators')}
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <button type="button" onClick={() => setIsImportOpen(true)} className="tt-button tt-button-secondary w-full sm:w-auto"><Upload size={16} aria-hidden="true" />Import Users</button>
              <button type="button" onClick={() => handleOpenAddForRole('student')} className="tt-button tt-button-primary w-full sm:w-auto"><Plus size={16} aria-hidden="true" />Add user</button>
            </div>
          </div>
        }
      />

      <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
        <SummaryCard icon={UserCheck} title={pluralize(totalStudents, 'Student', 'Students')} value={totalStudents} trendText={`${pluralize(activeStudents, 'active student', 'active students')}`} iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={Activity} title={pluralize(totalInstructors, 'Instructor', 'Instructors')} value={totalInstructors} trendText={`${pluralize(activeInstructors, 'active instructor', 'active instructors')}`} iconBg="bg-emerald-50" iconColor="text-emerald-900" />
        <SummaryCard icon={ShieldCheck} title={pluralize(totalAdmins, 'Administrator', 'Administrators')} value={totalAdmins} trendText={`${pluralize(activeAdmins, 'active administrator', 'active administrators')}`} iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={CircleOff} title={`Inactive ${pluralize(inactiveUsers, 'Account', 'Accounts')}`} value={inactiveUsers} trendText={`Across ${pluralize(totalUsers, 'account')}`} iconBg="bg-amber-50" iconColor="text-amber-900" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <section className="min-w-0 rounded-[12px] border border-[#E5E7EB] bg-white p-3 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#102a4c]">User Directory</h2>
            <p className="text-sm text-[#64748b]">Browse registered users and account access.</p>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-3 lg:w-auto lg:flex-row">
            <SearchField value={query} onChange={(value) => { setQuery(value); setPage(1) }} onClear={() => { setQuery(''); setPage(1) }} placeholder="Search name, username, email, ID, or NFC UID" ariaLabel="Search users" className="w-full flex-1 lg:min-w-[280px] lg:max-w-[380px]" />
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:flex">
                <select value={filters.status} onChange={(event) => { setFilters((current) => ({ ...current, status: event.target.value })); setPage(1) }} className="tt-control w-full lg:min-w-[170px]">
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                {activeRole === 'student' && (
                  <select value={filters.section} onChange={(event) => { setFilters((current) => ({ ...current, section: event.target.value })); setPage(1) }} className="tt-control w-full lg:min-w-[190px]">
                    <option value="">All sections</option>
                    {sectionOptions.map((section) => (
                      <option key={section} value={section}>{section}</option>
                    ))}
                  </select>
                )}
                {activeRole === 'instructor' && (
                  <select value={filters.section} onChange={(event) => { setFilters((current) => ({ ...current, section: event.target.value })); setPage(1) }} className="tt-control w-full lg:min-w-[210px]">
                    <option value="">All assigned sections</option>
                    {assignedSectionOptions.map((section) => (
                      <option key={section} value={section}>{section}</option>
                    ))}
                  </select>
                )}
            </div>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <label className="inline-flex min-h-10 items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" aria-label="Select visible users" checked={visibleUsers.length > 0 && visibleUsers.every((user) => selectedIds.includes(getUserId(user)))} onChange={selectVisibleUsers} className="h-4 w-4 rounded border-slate-300 text-[#002B5B] focus:ring-[#FFC107]" />
              Select page
            </label>
            <AnchoredMenu
              open={bulkMenuOpen}
              onOpenChange={setBulkMenuOpen}
              ariaLabel="Bulk user actions"
              renderTrigger={(props) => <button {...props} type="button" disabled={!selectedIds.length || actionBusy} className="tt-button tt-button-secondary disabled:cursor-not-allowed disabled:opacity-50">Bulk Actions{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}<ChevronDown size={16} aria-hidden="true" /></button>}
            >
              <>
                {bulkMenuItem('activate', 'Activate', UserRoundCheck)}
                {bulkMenuItem('deactivate', 'Deactivate', UserRoundX, protectedSelection.length > 0)}
                {bulkMenuItem('delete', 'Delete', Trash2, protectedSelection.length > 0, true)}
                <div className="my-1 border-t border-slate-100" role="separator" />
                {bulkMenuItem('export_csv', 'Export CSV', FileText)}
                {bulkMenuItem('export_excel', 'Export Excel', FileSpreadsheet)}
              </>
            </AnchoredMenu>
            {protectedSelection.length > 0 && <span className="text-xs text-amber-800">Protected administrator accounts cannot be deactivated or deleted here.</span>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 text-right text-sm text-slate-500">
            <span>{pluralize(filteredUsers.length, 'result')}{selectedIds.length > 0 && <span className="ml-2 font-semibold text-[#002B5B]">{pluralize(selectedIds.length, 'user')} selected</span>}</span>
            {(query || activeRole !== 'all' || filters.status || filters.section) && <button type="button" onClick={() => { setQuery(''); setActiveRole('all'); setFilters({ status: '', section: '' }); setPage(1) }} className="min-h-9 text-xs font-semibold text-[#1d5b91] hover:underline">Reset Filters</button>}
          </div>
        </div>
        {loading ? (
          <TableSkeleton />
        ) : users.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-slate-500">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white text-3xl shadow-sm">👥</div>
            <p className="text-lg font-semibold text-slate-900">No users found</p>
            <p className="mt-2 text-sm text-slate-600">Get started by adding your first student, instructor, or administrator.</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={visibleUsers}
            loading={loading}
            showActions={false}
            expandable
            variant="users"
            constrainTableHeight={false}
            emptyMessage={filteredUsers.length ? 'No users match your filters.' : 'No users found.'}
            renderMobileCard={(row, { expanded, toggleExpanded }) => {
              const name = `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.username || 'Unnamed user'
              return (
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start gap-2">
                    <input type="checkbox" aria-label={`Select ${row.username}`} checked={selectedIds.includes(getUserId(row))} onChange={() => toggleUserSelection(row)} className="mt-2 h-4 w-4 shrink-0 rounded border-slate-300 text-[#002B5B] focus:ring-[#FFC107]" />
                    <UserAvatar user={row} size="md" alt={`${name} profile picture`} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold text-[#102a4c]">{name}</p>
                      <p className="break-all text-xs text-slate-500">@{row.username}</p>
                    </div>
                    <ActionsMenu user={row} onAction={handleRowAction} protectedAccount={isProtectedAccount(row)} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">
                    {roleBadge(row.role)}{statusBadge(row)}{nfcStatusBadge(row)}
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-slate-100 pt-3 pl-6 text-xs">
                    <dt className="text-slate-500">Email</dt><dd className="min-w-0 break-all text-right text-slate-700">{row.email || '—'}</dd>
                    <dt className="text-slate-500">User ID</dt><dd className="min-w-0 break-all text-right text-slate-700">{row.student_id || row.instructor_id || row.id}</dd>
                  </dl>
                  <button type="button" aria-expanded={expanded} aria-controls={`user-details-${getUserId(row)}`} onClick={toggleExpanded} className="ml-6 mt-2 min-h-9 text-xs font-semibold text-[#1d5b91] hover:underline">{expanded ? 'Less details' : 'More details'}</button>
                  {expanded && <div id={`user-details-${getUserId(row)}`} className="ml-6 mt-2 border-t border-slate-100 pt-3">
                    <UserDetailsPanel user={row} />
                  </div>}
                  <button type="button" onClick={() => handleRowAction('view', row)} className="ml-6 mt-2 min-h-9 rounded-md border border-slate-200 px-3 text-xs font-semibold text-[#002B5B] hover:bg-slate-50">View Profile</button>
                </div>
              )
            }}
            renderExpandedRow={(row) => <UserDetailsPanel user={row} />}
          />
        )}
        {!loading && users.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500">Showing {filteredUsers.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filteredUsers.length)} of {filteredUsers.length}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1} aria-label="Previous users page" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 disabled:opacity-40"><ChevronLeft size={16} /></button>
              <span className="min-w-16 text-center text-xs text-slate-600">Page {currentPage} of {pageCount}</span>
              <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage >= pageCount} aria-label="Next users page" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 disabled:opacity-40"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </section>

      {toastMessage && (
        <div className={`fixed bottom-4 right-4 z-[var(--tt-layer-toast)] max-w-[320px] rounded-[14px] border px-4 py-3 text-sm shadow-lg transition duration-200 ${toastType === 'error' ? 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]' : 'border-[#D1FAE5] bg-[#ECFDF5] text-[#065F46]'}`}>
          {toastMessage}
        </div>
      )}

      <AddUserModal
        isOpen={isAddUserOpen}
        onClose={() => setIsAddUserOpen(false)}
        onUnauthorized={() => navigate('/admin/login')}
        onSaved={handleUserSaved}
        initialRole={selectedRole}
      />

      <UserImportWizard
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImported={() => {
          setSelectedIds([])
          void fetchUsers()
        }}
      />

      <EditUserModal
        isOpen={isEditModalOpen}
        userId={editingUserId}
        user={selectedUser || { id: editingUserId }}
        onClose={() => {
          setIsEditModalOpen(false)
          setEditingUserId(null)
          setSelectedUser(null)
        }}
        onUnauthorized={() => navigate('/admin/login')}
        onSaved={handleUserSaved}
      />
      <UserDrawer key={getUserId(drawerUser) || 'closed'} user={drawerUser} onClose={closeUserDrawer} onAction={handleRowAction} />
      <UserActionDialog
        key={`${pendingAction?.type || 'closed'}:${getUserId(pendingAction?.user) || pendingAction?.ids?.join(',') || ''}`}
        action={pendingAction?.type}
        user={pendingAction?.user}
        count={pendingAction?.ids?.length || 0}
        busy={actionBusy}
        error={actionError}
        onClose={() => { if (!actionBusy) { setPendingAction(null); setActionError('') } }}
        onConfirm={handleConfirmAction}
      />
    </div>
  )

  async function handleRowAction(action, row) {
    const id = getUserId(row)
    if (!id) return
    if (action === 'view') {
      setDrawerUser(row)
      return
    }
    if (action === 'edit') {
      setEditingUserId(id)
      setSelectedUser(row)
      setIsEditModalOpen(true)
      return
    }
    if (isProtectedAccount(row) && ['activate', 'deactivate', 'delete'].includes(action)) return
    setActionError('')
    setPendingAction({ type: action, user: row })
  }

  function handleBulkAction(action) {
    if (!selectedIds.length) return
    if (action === 'export_csv') return handleExport()
    if (action === 'export_excel') return handleExportExcel()
    const protectedUsers = selectedUsers.filter(isProtectedAccount)
    if (protectedUsers.length && ['deactivate', 'delete'].includes(action)) {
      showToast('Remove protected administrator accounts from the selection before this action.', 'error')
      return
    }
    setActionError('')
    setPendingAction({ type: `bulk_${action}`, ids: [...selectedIds] })
  }

  async function handleConfirmAction(payload) {
    if (!pendingAction || actionBusy) return
    if (pendingAction.type === 'reset_password') {
      setPendingAction(null)
      navigate('/forgot-password')
      return
    }

    const isBulk = pendingAction.type.startsWith('bulk_')
    const action = isBulk ? pendingAction.type.slice(5) : pendingAction.type
    const user = pendingAction.user
    const ids = isBulk ? pendingAction.ids : [getUserId(user)]
    if (action === 'assign_nfc') {
      const requestedUid = String(payload?.nfc_uid || '').trim().toLowerCase()
      const duplicate = users.find((candidate) => String(candidate.nfc_uid || '').trim().toLowerCase() === requestedUid && String(getUserId(candidate)) !== String(ids[0]))
      if (duplicate) {
        setActionError('This NFC UID is already assigned to another user.')
        return
      }
    }
    setActionBusy(true)
    setActionError('')
    let completed = 0
    let firstError = ''

    try {
      for (const id of ids) {
        try {
          if (action === 'delete') await api.delete(`/users/${id}/`)
          else {
            const body = action === 'assign_nfc' ? payload : { is_active: action === 'activate' }
            const response = await api.patch(`/users/${id}/`, body)
            if (!isBulk && response.data) {
              setDrawerUser((current) => String(getUserId(current)) === String(id) ? { ...current, ...response.data } : current)
            }
          }
          completed += 1
        } catch (error) {
          const detail = error.response?.data?.detail || error.response?.data?.nfc_uid?.[0] || error.message
          firstError ||= detail || 'The server rejected this action.'
          if (!isBulk) throw error
        }
      }

      if (completed) {
        setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
        await fetchUsers()
        const verb = action === 'assign_nfc' ? 'NFC UID updated' : action === 'activate' ? 'Account activated' : action === 'deactivate' ? 'Account deactivated' : 'Account deleted'
        if (completed === ids.length) showToast(isBulk ? `${completed} accounts updated.` : `${verb}.`, 'success')
      }
      if (completed === ids.length || isBulk) setPendingAction(null)
      if (completed < ids.length && isBulk) showToast(`${completed} of ${ids.length} accounts processed. ${firstError}`, 'error')
    } catch (error) {
      if (error.response?.status === 401) {
        navigate('/admin/login')
        return
      }
      setActionError(error.response?.data?.detail || error.response?.data?.nfc_uid?.[0] || 'The action failed. Check the user and try again.')
    } finally {
      setActionBusy(false)
    }
  }

  function handleExport() {
    const rows = users.filter(u => selectedIds.includes(u.id))
    if (!rows.length) return
    const csv = [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).map(v=>`"${String(v||'')?.replace(/"/g,'""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'users_export.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function handleExportExcel() {
    if (!selectedUsers.length) return
    try {
      const response = await api.post('/users/export-excel/', { ids: selectedIds }, { responseType: 'blob' })
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'users-management-report.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (exportError) {
      if (exportError.response?.status === 401) {
        navigate('/admin/login')
        return
      }
      showToast('Failed to export selected users.', 'error')
    }
  }
}
