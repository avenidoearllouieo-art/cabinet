import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'

export default function StudentChangePassword() {
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required.')
      return
    }

    setLoading(true)
    try {
      await api.post('/users/change_password/', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
      setSuccess('Password changed successfully. Please log in again.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => {
        localStorage.removeItem('access')
        localStorage.removeItem('refresh')
        localStorage.removeItem('user')
        navigate('/student/login')
      }, 1500)
    } catch (err) {
      console.error('Password change failed', err)
      setError(err.response?.data?.new_password?.[0] || err.response?.data?.confirm_password?.[0] || err.response?.data?.current_password?.[0] || err.response?.data?.detail || 'Password change failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <PageHeader
          title="Change Password"
          description="Secure your account with a strong new password."
        />
        <button
          type="button"
          onClick={() => navigate('/student/profile')}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Back to Profile
        </button>
      </div>

      <div className="rounded-[20px] border border-[#E5E7EB] bg-white p-6 shadow-sm max-w-3xl">
        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-slate-400"
              placeholder="Enter current password"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-slate-400"
              placeholder="Enter new password"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-slate-400"
              placeholder="Repeat new password"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center rounded-2xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? 'Saving...' : 'Change Password'}
            </button>
            <p className="text-sm text-slate-500">You will be required to log in again after a successful password change.</p>
          </div>
        </form>
      </div>
    </div>
  )
}
