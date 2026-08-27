import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import TableSkeleton from '../../components/TableSkeleton'
import DataTable from '../../components/DataTable'
import AddUserModal from '../../components/users/AddUserModal.jsx'
import EditUserModal from '../../components/users/EditUserModal.jsx'
import ActionsMenu from '../../components/users/ActionsMenu.jsx'
import UserDrawer from '../../components/users/UserDrawer.jsx'
import { Search, Plus, Users as UsersIcon, CheckCircle2, CircleOff, ChevronDown, FileText, FileSpreadsheet, Wifi, UserMinus, Trash2, ShieldCheck, Activity, UserCheck } from 'lucide-react'

export default function Users() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [isAddUserOpen, setIsAddUserOpen] = useState(false)
  const [selectedRole, setSelectedRole] = useState('student')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef(null)
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const bulkMenuRef = useRef(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingUserId, setEditingUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const [toastType, setToastType] = useState('success')
  const [activeRole, setActiveRole] = useState('all')
  const [selectedIds, setSelectedIds] = useState([])
  const [drawerUser, setDrawerUser] = useState(null)
  const [filters, setFilters] = useState({ status: '', section: '' })

  const handleOpenAddUserModal = () => {
    setEditingUserId(null)
    setSelectedUser(null)
    setSelectedRole('student')
    setIsAddUserOpen(true)
  }

  const handleOpenAddForRole = (role) => {
    setEditingUserId(null)
    setSelectedUser(null)
    setSelectedRole(role)
    setIsAddUserOpen(true)
  }

  const showToast = (message, type = 'success') => {
    setToastMessage(message)
    setToastType(type)
    window.setTimeout(() => {
      setToastMessage('')
      setToastType('success')
    }, 4000)
  }

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
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  useEffect(() => {
    function onDocClick(e) {
      if (addMenuOpen && addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setAddMenuOpen(false)
      }
      if (bulkMenuOpen && bulkMenuRef.current && !bulkMenuRef.current.contains(e.target)) {
        setBulkMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [addMenuOpen, bulkMenuOpen])

  useEffect(() => {
    window.openEditModal = (id, row) => {
      if (!id) return
      setEditingUserId(id)
      setSelectedUser(row || null)
      setIsEditModalOpen(true)
    }
    return () => {
      try {
        delete window.openEditModal
      } catch (err) {}
    }
  }, [])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const response = await api.get('/users/')
      const rawUsers = Array.isArray(response.data) ? response.data : response.data.results || []
      const normalizedUsers = rawUsers.map((user) => ({
        ...user,
        id: user?.id ?? user?.pk ?? user?.user_id ?? user?.uuid,
      }))
      setUsers(normalizedUsers)
      setError('')
    } catch (err) {
      console.error('Error fetching users:', err)
      setError('Failed to load users.')
      showToast('Failed to load users. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

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

  useEffect(() => {
    setFilters((current) => ({ ...current, section: '' }))
  }, [activeRole])

  const filteredUsers = users.filter((user) => {
    const keyword = query.toLowerCase()
    const matchesQuery = [user.username, user.email, user.first_name, user.last_name, user.student_id, user.instructor_id, user.nfc_uid]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword))

    if (!matchesQuery) return false
    if (activeRole !== 'all' && user.role !== activeRole) return false
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

  const getUserId = (row) => row?.id ?? row?.pk ?? row?.user_id ?? row?.uuid

  const baseSelectColumn = {
    key: 'select',
    label: '',
    className: 'w-12',
    render: (_v, row) => {
      const id = getUserId(row)
      const checked = selectedIds.includes(id)
      return (
        <input type="checkbox" checked={checked} onChange={(e) => {
          e.stopPropagation()
          if (e.target.checked) setSelectedIds((s) => [...s, id])
          else setSelectedIds((s) => s.filter((x) => x !== id))
        }} />
      )
    }
  }

  const statusBadge = (row) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${row.is_active ? 'bg-[#ECFDF3] text-[#16A34A]' : 'bg-[#FEF2F2] text-[#DC2626]'}`}>
      {row.is_active ? <CheckCircle2 size={12} /> : <CircleOff size={12} />}
      {row.is_active ? 'Active' : 'Inactive'}
    </span>
  )

  const profileAvatar = (row) => {
    const initials = `${row.first_name?.[0] || ''}${row.last_name?.[0] || ''}`.trim().toUpperCase() || (row.username?.[0] || '').toUpperCase() || '?'
    const imageUrl = row.profile_image_url || row.profile_image || row.avatar_url || row.avatar

    return (
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-sm font-semibold uppercase text-slate-700">
          {imageUrl ? <img src={imageUrl} alt={row.username || initials} className="h-full w-full object-cover" /> : initials}
        </div>
      </div>
    )
  }

  const nfcStatusBadge = (uid) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${uid ? 'bg-[#ECFDF5] text-[#166534]' : 'bg-[#FEF3C7] text-[#92400E]'}`}>
      {uid ? 'Registered' : 'Not Assigned'}
    </span>
  )

  const roleBadge = (role) => {
    const normalized = (role || '').toLowerCase()
    const classes = {
      administrator: 'bg-[#F3E8FF] text-[#6D28D9]',
      admin: 'bg-[#F3E8FF] text-[#6D28D9]',
      instructor: 'bg-[#DBEAFE] text-[#1D4ED8]',
      student: 'bg-[#DCFCE7] text-[#15803D]',
    }[normalized] || 'bg-[#E5E7EB] text-[#374151]'

    const label = normalized === 'administrator' || normalized === 'admin' ? 'Administrator' : normalized === 'instructor' ? 'Instructor' : normalized === 'student' ? 'Student' : role || 'Unknown'

    return (
      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${classes}`}>
        {label}
      </span>
    )
  }

  const nfcBadge = (uid) => {
    if (uid) {
      return (
        <div className="space-y-1">
          <span className="inline-flex rounded-full bg-[#ECFDF5] px-3 py-1 text-xs font-semibold text-[#166534]">Registered</span>
          <div className="max-w-[200px] truncate text-sm text-[#0F172A]" title={uid}>{uid}</div>
        </div>
      )
    }
    return <span className="inline-flex rounded-full bg-[#FEF3C7] px-3 py-1 text-xs font-semibold text-[#92400E]">Not Assigned</span>
  }

  const studentColumns = [
    baseSelectColumn,
    { key: 'student_id', label: 'Student ID' },
    { key: 'username', label: 'Username' },
    { key: 'name', label: 'Full Name', className: 'min-w-[240px]', render: (_v, row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() || '—' },
    { key: 'section_name', label: 'Section', render: (_v, row) => row.section_name || row.section || '—' },
    { key: 'email', label: 'Email' },
    { key: 'nfc_uid', label: 'NFC UID', render: (_v, row) => nfcStatusBadge(row.nfc_uid) },
    { key: 'status', label: 'Status', render: (_v, row) => statusBadge(row) },
    { key: 'actions', label: 'Actions', render: (_v, row) => <ActionsMenu user={row} onAction={handleRowAction} /> }
  ]

  const instructorColumns = [
    baseSelectColumn,
    { key: 'instructor_id', label: 'Instructor ID' },
    { key: 'username', label: 'Username' },
    { key: 'name', label: 'Full Name', className: 'min-w-[240px]', render: (_v, row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() || '—' },
    { key: 'assigned_sections', label: 'Assigned Sections', render: (_v, row) => (row.assigned_sections && row.assigned_sections.length ? row.assigned_sections.map(s=>s.section_name||s.section_name).join(', ') : '—') },
    { key: 'email', label: 'Email' },
    { key: 'nfc_uid', label: 'NFC UID', render: (_v, row) => nfcStatusBadge(row.nfc_uid) },
    { key: 'status', label: 'Status', render: (_v, row) => statusBadge(row) },
    { key: 'actions', label: 'Actions', render: (_v, row) => <ActionsMenu user={row} onAction={handleRowAction} /> }
  ]

  const adminColumns = [
    baseSelectColumn,
    { key: 'admin_id', label: 'Admin ID', render: (_v, row) => row.id },
    { key: 'username', label: 'Username' },
    { key: 'name', label: 'Full Name', className: 'min-w-[240px]', render: (_v, row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() || '—' },
    { key: 'email', label: 'Email' },
    { key: 'nfc_uid', label: 'NFC UID', render: (_v, row) => nfcStatusBadge(row.nfc_uid) },
    { key: 'status', label: 'Status', render: (_v, row) => statusBadge(row) },
    { key: 'actions', label: 'Actions', render: (_v, row) => <ActionsMenu user={row} onAction={handleRowAction} /> }
  ]

  const allColumns = [
    baseSelectColumn,
    { key: 'profile', label: 'Profile', className: 'min-w-[180px]', render: (_v, row) => profileAvatar(row) },
    { key: 'username', label: 'Username' },
    { key: 'name', label: 'Full Name', className: 'min-w-[220px]', render: (_v, row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() || '—' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role', render: (_v, row) => roleBadge(row.role) },
    { key: 'nfc_status', label: 'NFC Status', render: (_v, row) => nfcStatusBadge(row.nfc_uid) },
    { key: 'status', label: 'Account Status', render: (_v, row) => statusBadge(row) },
    { key: 'actions', label: 'Actions', render: (_v, row) => <ActionsMenu user={row} onAction={handleRowAction} /> }
  ]

  const columns = activeRole === 'student' ? studentColumns : activeRole === 'instructor' ? instructorColumns : activeRole === 'admin' ? adminColumns : allColumns

  const totalUsers = users.length
  const totalStudents = users.filter((u) => u.role === 'student').length
  const totalInstructors = users.filter((u) => u.role === 'instructor').length
  const totalAdmins = users.filter((u) => u.role === 'admin').length
  const activeUsers = users.filter((user) => user.is_active).length
  const inactiveUsers = totalUsers - activeUsers

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users Management"
        description="Manage system users, roles, and permissions"
        action={
          <div className="flex items-center gap-3">
            <div className="rounded-md border bg-white p-1">
              <button onClick={() => setActiveRole('all')} className={`px-3 py-1 ${activeRole==='all'?'bg-blue-50 font-semibold':''}`}>All Users</button>
              <button onClick={() => setActiveRole('student')} className={`px-3 py-1 ${activeRole==='student'?'bg-blue-50 font-semibold':''}`}>Students</button>
              <button onClick={() => setActiveRole('instructor')} className={`px-3 py-1 ${activeRole==='instructor'?'bg-blue-50 font-semibold':''}`}>Instructors</button>
              <button onClick={() => setActiveRole('admin')} className={`px-3 py-1 ${activeRole==='admin'?'bg-blue-50 font-semibold':''}`}>Administrators</button>
            </div>
            <div className="relative" ref={addMenuRef}>
              <button type="button" onClick={() => setAddMenuOpen((s) => !s)} className="flex items-center gap-2 rounded-[10px] bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1D4ED8]">
                <Plus size={16} />
                Add
              </button>
              {addMenuOpen && (
                <div className="absolute right-0 mt-10 w-[220px] rounded border bg-white shadow-lg" onClick={(e)=>e.stopPropagation()}>
                  <button className="block w-full px-4 py-2 text-left" onClick={() => { setAddMenuOpen(false); handleOpenAddForRole('student') }}>Add Student</button>
                  <button className="block w-full px-4 py-2 text-left" onClick={() => { setAddMenuOpen(false); handleOpenAddForRole('instructor') }}>Add Instructor</button>
                  <button className="block w-full px-4 py-2 text-left" onClick={() => { setAddMenuOpen(false); handleOpenAddForRole('admin') }}>Add Administrator</button>
                </div>
              )}
            </div>
          </div>
        }
      />

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={UserCheck} title="Students" value={totalStudents} trendText="Stable enrollment" trendColor="text-emerald-600" iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={Activity} title="Instructors" value={totalInstructors} trendText="Staff count rising" trendColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-900" />
        <SummaryCard icon={ShieldCheck} title="Administrators" value={totalAdmins} trendText="Consistent coverage" trendColor="text-emerald-600" iconBg="bg-violet-50" iconColor="text-violet-900" />
        <SummaryCard icon={CircleOff} title="Inactive Accounts" value={inactiveUsers} trendText="Requires review" trendColor="text-rose-600" iconBg="bg-amber-50" iconColor="text-amber-900" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">User Directory</h2>
            <p className="text-sm text-[#6B7280]">Browse registered users and their roles.</p>
          </div>
          <div className="flex flex-col gap-4 xl:flex-1">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <label className="relative block w-full lg:mr-auto lg:max-w-[360px]">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6B7280]">
                  <Search size={16} />
                </span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search users..."
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-10 text-sm text-slate-700 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
                />
              </label>
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end lg:ml-auto lg:w-auto">
                <select value={filters.status} onChange={(e)=>setFilters(f=>({...f,status:e.target.value}))} className="h-11 min-w-[180px] rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                {activeRole === 'student' && (
                  <select value={filters.section} onChange={(e)=>setFilters(f=>({...f,section:e.target.value}))} className="h-11 min-w-[180px] rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
                    <option value="">All sections</option>
                    {sectionOptions.map((section) => (
                      <option key={section} value={section}>{section}</option>
                    ))}
                  </select>
                )}
                {activeRole === 'instructor' && (
                  <select value={filters.section} onChange={(e)=>setFilters(f=>({...f,section:e.target.value}))} className="h-11 min-w-[180px] rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
                    <option value="">All assigned sections</option>
                    {assignedSectionOptions.map((section) => (
                      <option key={section} value={section}>{section}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative" ref={bulkMenuRef}>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => setBulkMenuOpen((s) => !s)}
              className={`inline-flex h-11 min-h-[44px] items-center gap-2 rounded-[10px] border px-4 py-2 text-sm font-semibold transition ${selectedIds.length === 0 ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'}`}
            >
              Bulk Actions
              <ChevronDown size={18} />
            </button>
            {bulkMenuOpen && selectedIds.length > 0 && (
              <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg transition-all duration-200 ease-out">
                <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setBulkMenuOpen(false); handleBulkAction('activate') }}>
                  <CheckCircle2 size={16} />
                  Activate
                </button>
                <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { if (confirm(`Deactivate ${selectedIds.length} selected users?`)) { setBulkMenuOpen(false); handleBulkAction('deactivate') } }}>
                  <UserMinus size={16} />
                  Deactivate
                </button>
                <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setBulkMenuOpen(false); handleBulkAction('delete') }}>
                  <Trash2 size={16} />
                  Delete
                </button>
                <div className="my-2 h-px bg-slate-200" />
                <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setBulkMenuOpen(false); handleBulkAction('export_csv') }}>
                  <FileText size={16} />
                  Export CSV
                </button>
                <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setBulkMenuOpen(false); handleBulkAction('export_excel') }}>
                  <FileSpreadsheet size={16} />
                  Export Excel
                </button>
                <div className="my-2 h-px bg-slate-200" />
                <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setBulkMenuOpen(false); handleBulkAction('assign_nfc') }}>
                  <Wifi size={16} />
                  Assign NFC UID
                </button>
              </div>
            )}
          </div>
          <div className="text-sm text-slate-500">{filteredUsers.length} result{filteredUsers.length === 1 ? '' : 's'}</div>
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
          <DataTable columns={columns} data={filteredUsers} loading={loading} showActions={false} emptyMessage={users.length ? 'No users match your filters.' : 'No users available.'} />
        )}
      </div>

      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 max-w-[320px] rounded-[14px] border px-5 py-4 text-sm shadow-lg transition duration-200 ${toastType === 'error' ? 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]' : 'border-[#D1FAE5] bg-[#ECFDF5] text-[#065F46]'}`}>
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
      <UserDrawer user={drawerUser} onClose={() => setDrawerUser(null)} />
    </div>
  )

  async function handleRowAction(action, row) {
    const id = row?.id
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
    if (action === 'assign_nfc') {
      const nfc = window.prompt('Enter NFC UID')
      if (!nfc) return
      await api.patch(`/users/${id}/`, { nfc_uid: nfc })
      fetchUsers()
      setToastMessage('NFC assigned.')
      setTimeout(()=>setToastMessage(''),3000)
      return
    }
    if (action === 'reset_password') {
      const pw = window.prompt('Enter new password')
      if (!pw) return
      await api.patch(`/users/${id}/`, { password: pw })
      setToastMessage('Password reset.')
      setTimeout(()=>setToastMessage(''),3000)
      return
    }
    if (action === 'activate' || action === 'deactivate') {
      await api.patch(`/users/${id}/`, { is_active: action === 'activate' })
      fetchUsers()
      return
    }
    if (action === 'delete') {
      if (!confirm('Delete this user?')) return
      await api.delete(`/users/${id}/`)
      fetchUsers()
      return
    }
  }

  async function handleBulkAction(action) {
    if (!selectedIds.length) return
    if (action === 'export_csv') return handleExport()
    if (action === 'export_excel') return handleExportExcel()
    if (action === 'assign_nfc') {
      const nfc = window.prompt('Enter NFC UID for selected users')
      if (!nfc) return
      for (const id of selectedIds) {
        try { await api.patch(`/users/${id}/`, { nfc_uid: nfc }) } catch (e) { console.error(e) }
      }
      setSelectedIds([])
      fetchUsers()
      setToastMessage('NFC assigned to selected users.')
      setTimeout(()=>setToastMessage(''),3000)
      return
    }
    if (action === 'delete') {
      if (!confirm(`Delete ${selectedIds.length} users?`)) return
      for (const id of selectedIds) {
        try { await api.delete(`/users/${id}/`) } catch (e) { console.error(e) }
      }
      setSelectedIds([])
      fetchUsers()
      return
    }
    if (action === 'activate' || action === 'deactivate') {
      for (const id of selectedIds) {
        try { await api.patch(`/users/${id}/`, { is_active: action === 'activate' }) } catch (e) { console.error(e) }
      }
      setSelectedIds([])
      fetchUsers()
      return
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

  function handleExportExcel() {
    const rows = users.filter(u => selectedIds.includes(u.id))
    if (!rows.length) return
    const csv = rows.map((row) => Object.values(row).map((value) => String(value || '')).join('\t')).join('\n')
    const blob = new Blob([csv], { type: 'application/vnd.ms-excel' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'users_export.xls'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
}
