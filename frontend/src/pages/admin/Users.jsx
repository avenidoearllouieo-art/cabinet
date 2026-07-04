import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import AddUserModal from '../../components/users/AddUserModal.jsx'
import EditUserModal from '../../components/users/EditUserModal.jsx'
import { Search, Plus, Users as UsersIcon, CheckCircle2, CircleOff } from 'lucide-react'

export default function Users() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [isAddUserOpen, setIsAddUserOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingUserId, setEditingUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [toastMessage, setToastMessage] = useState('')

  const handleOpenAddUserModal = () => {
    setEditingUserId(null)
    setSelectedUser(null)
    setIsAddUserOpen(true)
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

    setToastMessage(editingUserId ? 'User updated successfully.' : 'User created successfully.')
    setIsAddUserOpen(false)
    setIsEditModalOpen(false)
    setEditingUserId(null)
    setSelectedUser(null)
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  useEffect(() => {
    fetchUsers()
  }, [])

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
    } finally {
      setLoading(false)
    }
  }

  const filteredUsers = users.filter((user) => {
    const keyword = query.toLowerCase()
    return [user.username, user.email, user.first_name, user.last_name, user.student_id]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword))
  })

  const getUserId = (row) => row?.id ?? row?.pk ?? row?.user_id ?? row?.uuid

  const columns = [
    {
      key: 'actions',
      label: 'Actions',
      className: 'w-[140px] text-left',
      render: (_value, row) => {
        const id = getUserId(row)
        return (
          <button
            type="button"
            data-user-id={id || ''}
            onClick={(e) => {
              e.stopPropagation()
              if (id != null) {
                setEditingUserId(id)
                setSelectedUser(row)
                setIsEditModalOpen(true)
              }
            }}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            Edit User
          </button>
        )
      },
    },
    { key: 'student_id', label: 'Student ID' },
    { key: 'username', label: 'Username' },
    {
      key: 'name',
      label: 'Name',
      className: 'min-w-[240px]',
      render: (_value, row) => {
        const fullName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || '—'
        return <span className="text-sm text-[#111827]">{fullName}</span>
      },
    },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'section', label: 'Section' },
    {
      key: 'status',
      label: 'Status',
      render: (_value, row) => (
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${row.is_active ? 'bg-[#ECFDF3] text-[#16A34A]' : 'bg-[#FEF2F2] text-[#DC2626]'}`}>
          {row.is_active ? <CheckCircle2 size={12} /> : <CircleOff size={12} />}
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
  ]

  const totalUsers = users.length
  const activeUsers = users.filter((user) => user.is_active).length
  const inactiveUsers = totalUsers - activeUsers

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users Management"
        description="Manage system users, roles, and permissions"
        action={
          <button
            type="button"
            onClick={handleOpenAddUserModal}
            className="flex items-center gap-2 rounded-[10px] bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1D4ED8]"
          >
            <Plus size={16} />
            Add User
          </button>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <StatCard icon={<UsersIcon size={18} />} label="Total Users" value={totalUsers} subtitle="All registered accounts" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Active" value={activeUsers} subtitle="Currently active" />
        <StatCard icon={<CircleOff size={18} />} label="Inactive" value={inactiveUsers} subtitle="Pending review" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">User Directory</h2>
            <p className="text-sm text-[#6B7280]">Browse registered users and their roles.</p>
          </div>
          <label className="relative block w-full md:w-[320px]">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6B7280]">
              <Search size={16} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users..."
              className="h-10 w-full rounded-[10px] border border-[#D1D5DB] bg-white pl-9 pr-3 text-sm text-[#374151] outline-none focus:border-[#2563EB]"
            />
          </label>
        </div>
        <DataTable columns={columns} data={filteredUsers} loading={loading} />
      </div>

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-[14px] border border-[#D1FAE5] bg-[#ECFDF5] px-5 py-4 text-sm text-[#065F46] shadow-lg">
          {toastMessage}
        </div>
      )}

      <AddUserModal
        isOpen={isAddUserOpen}
        onClose={() => setIsAddUserOpen(false)}
        onUnauthorized={() => navigate('/admin/login')}
        onSaved={handleUserSaved}
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
    </div>
  )
}
