import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import api from '../../services/api.js'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const portal = location.pathname.split('/')[1] || ''

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    try {
      const response = await api.post('/auth/login/', {
        username,
        password,
        expected_role: portal,
      })

      const { access, refresh, user } = response.data

      if (!user || !user.role) {
        setError('Login response did not include a valid user role.')
        return
      }

      localStorage.setItem('access', access)
      localStorage.setItem('refresh', refresh)
      localStorage.setItem('user', JSON.stringify(user))
      api.defaults.headers.common.Authorization = `Bearer ${access}`

      if (user.role === 'admin') navigate('/admin/dashboard')
      else if (user.role === 'instructor') navigate('/instructor/dashboard')
      else if (user.role === 'student') navigate('/student/dashboard')
      else setError('Unable to redirect: unknown user role.')
    } catch (loginError) {
      const message =
        loginError.response?.data?.detail ||
        loginError.response?.data?.error ||
        'Login failed. Please check your credentials.'
      setError(message)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-semibold">TapTrack</h1>
          <span className="inline-flex items-center px-3 py-1 mt-4 text-sm font-medium text-slate-700 bg-slate-100 rounded-full border border-slate-200">
            {portal || 'portal'}
          </span>
        </div>

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Enter your username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Enter your password"
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-2xl bg-slate-900 text-white py-3 font-semibold hover:bg-slate-800 transition"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}
