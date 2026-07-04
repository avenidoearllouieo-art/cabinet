$content = @'
import { useEffect, useState } from 'react'
import axios from 'axios'
import PageHeader from '../../components/PageHeader'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'instructor', label: 'Instructor' },
  { value: 'student', label: 'Student' },
]

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

export default function Users() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [sections, setSections] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    student_id: '',
    username: '',
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirm_password: '',
    role: '',
    section: '',
    status: 'active',
  })
  const [formErrors, setFormErrors] = useState({})
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    fetchUsers()
    fetchSections()
  }, [])

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [errorMessage])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const response = await axios.get('/api/users/')
      setUsers(response.data)
      setError('')
    } catch (err) {
      setError('Failed to load users')
      console.error('Error fetching users:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchSections = async () => {
    try {
      const response = await axios.get('/api/sections/')
      setSections(response.data)
    } catch (err) {
      console.error('Failed to load sections:', err)
    }
  }

  const filteredUsers = users.filter(user => {
    const matchesSearch =
      user.first_name.toLowerCase().includes(searchText.toLowerCase()) ||
      user.last_name.toLowerCase().includes(searchText.toLowerCase()) ||
      user.username.toLowerCase().includes(searchText.toLowerCase()) ||
      user.email.toLowerCase().includes(searchText.toLowerCase()) ||
      (user.student_id && user.student_id.toLowerCase().includes(searchText.toLowerCase()))

    const matchesRole = !roleFilter || user.role === roleFilter
    const matchesStatus = !statusFilter || user.is_active === (statusFilter === 'active')

    return matchesSearch && matchesRole && matchesStatus
  })

  const totalUsers = users.length
  const activeUsers = users.filter(u => u.is_active).length
  const inactiveUsers = totalUsers - activeUsers

  const handleAddUser = () => {
    setForm({
      student_id: '',
      username: '',
      first_name: '',
      last_name: '',
      email: '',
      password: '',
      confirm_password: '',
      role: '',
      section: '',
      status: 'active',
    })
    setFormErrors({})
    setErrorMessage('')
    setSuccessMessage('')
    setIsModalOpen(true)
  }

  const validateForm = () => {
    const errors = {}

    if (!form.student_id.trim()) errors.student_id = 'Student ID is required'
    if (!form.username.trim()) errors.username = 'Username is required'
    if (!form.first_name.trim()) errors.first_name = 'First name is required'
    if (!form.last_name.trim()) errors.last_name = 'Last name is required'
    if (!form.email.trim()) errors.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Invalid email format'
    if (!form.password) errors.password = 'Password is required'
    else if (form.password.length < 6) errors.password = 'Password must be at least 6 characters'
    if (!form.confirm_password) errors.confirm_password = 'Please confirm password'
    else if (form.password !== form.confirm_password) errors.confirm_password = 'Passwords do not match'
    if (!form.role) errors.role = 'Role is required'
    if (form.role === 'student' && !form.section) errors.section = 'Section is required for students'

    return errors
  }

  const handleFormChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({
      ...prev,
      [name]: value,
    }))
    if (formErrors[name]) {
      setFormErrors(prev => ({
        ...prev,
        [name]: '',
      }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const errors = validateForm()
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        student_id: form.student_id,
        username: form.username,
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        password: form.password,
        role: form.role,
        is_active: form.status === 'active',
      }

      if (form.role === 'student' && form.section) {
        payload.section = form.section
      }

      await axios.post('/api/users/', payload)
      setSuccessMessage('User created successfully!')
      setIsModalOpen(false)
      fetchUsers()
    } catch (err) {
      setErrorMessage(err.response?.data?.detail || 'Failed to create user')
      console.error('Error creating user:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    { key: 'student_id', label: 'Student ID' },
    { key: 'username', label: 'Username' },
    {
      key: 'name',
      label: 'Name',
      render: (row) => `${row.first_name} ${row.last_name}`,
    },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'section', label: 'Section', render: (row) => row.section || '—' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          row.is_active
            ? 'bg-green-100 text-green-800'
            : 'bg-red-100 text-red-800'
        }`}>
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users Management"
        description="Manage system users, roles, and permissions"
        action={{
          label: 'Add User',
          onClick: handleAddUser,
        }}
      />

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <p className="text-gray-600 text-sm font-medium">Total Users</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{totalUsers}</p>
        </div>
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <p className="text-gray-600 text-sm font-medium">Active</p>
          <p className="text-3xl font-bold text-green-600 mt-2">{activeUsers}</p>
        </div>
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <p className="text-gray-600 text-sm font-medium">Inactive</p>
          <p className="text-3xl font-bold text-red-600 mt-2">{inactiveUsers}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="Search users..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Roles</option>
            {roleOptions.map(role => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Status</option>
            {statusOptions.map(status => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
          {errorMessage}
        </div>
      )}

      <DataTable
        columns={columns}
        data={filteredUsers}
        loading={loading}
      />

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add New User"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Student ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="student_id"
                value={form.student_id}
                onChange={handleFormChange}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formErrors.student_id ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="e.g., STU001"
              />
              {formErrors.student_id && (
                <p className="text-red-500 text-xs mt-1">{formErrors.student_id}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="username"
                value={form.username}
                onChange={handleFormChange}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formErrors.username ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="e.g., john.doe"
              />
              {formErrors.username && (
                <p className="text-red-500 text-xs mt-1">{formErrors.username}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="first_name"
                value={form.first_name}
                onChange={handleFormChange}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formErrors.first_name ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="e.g., John"
              />
              {formErrors.first_name && (
                <p className="text-red-500 text-xs mt-1">{formErrors.first_name}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="last_name"
                value={form.last_name}
                onChange={handleFormChange}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formErrors.last_name ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="e.g., Doe"
              />
              {formErrors.last_name && (
                <p className="text-red-500 text-xs mt-1">{formErrors.last_name}</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleFormChange}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                formErrors.email ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="e.g., john@example.com"
            />
            {formErrors.email && (
              <p className="text-red-500 text-xs mt-1">{formErrors.email}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleFormChange}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formErrors.password ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="••••••••"
              />
              {formErrors.password && (
                <p className="text-red-500 text-xs mt-1">{formErrors.password}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                name="confirm_password"
                value={form.confirm_password}
                onChange={handleFormChange}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formErrors.confirm_password ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="••••••••"
              />
              {formErrors.confirm_password && (
                <p className="text-red-500 text-xs mt-1">{formErrors.confirm_password}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role <span className="text-red-500">*</span>
              </label>
              <select
                name="role"
                value={form.role}
                onChange={handleFormChange}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formErrors.role ? 'border-red-500' : 'border-gray-300'
                }`}
              >
                <option value="">Select a role</option>
                {roleOptions.map(role => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
              {formErrors.role && (
                <p className="text-red-500 text-xs mt-1">{formErrors.role}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Section {form.role === 'student' && <span className="text-red-500">*</span>}
              </label>
              <select
                name="section"
                value={form.section}
                onChange={handleFormChange}
                disabled={form.role !== 'student'}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  formErrors.section ? 'border-red-500' : 'border-gray-300'
                } ${form.role !== 'student' ? 'bg-gray-100 cursor-not-allowed' : ''}`}
              >
                <option value="">Select a section</option>
                {sections.map(section => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              {formErrors.section && (
                <p className="text-red-500 text-xs mt-1">{formErrors.section}</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              name="status"
              value={form.status}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {statusOptions.map(status => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              disabled={submitting}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
'@

$content | Out-File 'C:\Users\Avenido\CapstoneCabinet\frontend\src\pages\admin\Users.jsx' -Encoding UTF8
Write-Host "Users.jsx created successfully"
