import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import TapTrackLogo from '../../components/TapTrackLogo.jsx'
import { FormField, InlineFeedback } from '../../components/forms/FormPrimitives.jsx'

export default function Login({ administratorOnly = false }) {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const response = await api.post('/auth/login/', {
        username,
        password,
        ...(administratorOnly ? { expected_role: 'admin' } : {}),
      })

      const { access, refresh, user } = response.data

      if (!user || !user.role) {
        setError('Login response did not include a valid user role.')
        return
      }

      const allowedRoles = administratorOnly ? ['admin'] : ['student', 'instructor']
      if (!allowedRoles.includes(user.role)) {
        setError(
          administratorOnly
            ? 'This account is not an administrator account.'
            : 'Administrators must use the Administrator Login.',
        )
        return
      }

      localStorage.setItem('access', access)
      localStorage.setItem('refresh', refresh)
      localStorage.setItem('user', JSON.stringify(user))
      api.defaults.headers.common.Authorization = `Bearer ${access}`

      if (user.role === 'admin') navigate('/admin/dashboard')
      else if (user.role === 'instructor') navigate('/instructor/dashboard')
      else navigate('/student/dashboard')
    } catch (loginError) {
      const message =
        loginError.response?.data?.detail ||
        loginError.response?.data?.error ||
        'Login failed. Please check your credentials.'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6">
      <div className="login-grid absolute inset-0" aria-hidden="true" />
      <div className="login-wordmark-pattern" aria-hidden="true" />
      <div className="login-cabinet-mark absolute left-1/2 top-8 hidden -translate-x-1/2 md:block" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <section className="login-card relative z-10 w-full max-w-[430px] rounded-[22px] bg-white px-6 py-8 shadow-[0_22px_70px_rgba(28,53,84,0.14)] sm:px-10 sm:py-10">
        <div className="mb-8 text-center">
          <TapTrackLogo compact className="mx-auto mb-5 h-20 w-20" />
          <p className="mx-auto mt-2 max-w-[270px] text-sm leading-5 text-[#718096]">
            {administratorOnly ? 'Administrator access' : 'Cabinet Activity and User Management System'}
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <FormField label="Username" required>
            {({ id }) => <div className="login-field flex min-h-12 items-center gap-3 rounded-xl border border-[#dbe3ed] px-4 py-2.5 transition focus-within:border-transparent focus-within:ring-2 focus-within:ring-blue-900"><UserRound size={18} className="shrink-0 text-[#8291a5]" aria-hidden="true" /><input id={id} type="text" value={username} onChange={(event) => setUsername(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-[#14243a] outline-none placeholder:text-[#9aa8b8]" placeholder="Enter your assigned username" autoComplete="username" required /></div>}
          </FormField>

          <FormField label="Password" required>
            {({ id }) => <div className="login-field flex min-h-12 items-center gap-3 rounded-xl border border-[#dbe3ed] px-4 py-1 transition focus-within:border-transparent focus-within:ring-2 focus-within:ring-blue-900"><LockKeyhole size={18} className="shrink-0 text-[#8291a5]" aria-hidden="true" /><input id={id} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-[#14243a] outline-none placeholder:text-[#9aa8b8]" placeholder="Enter your password" autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8291a5] transition hover:bg-blue-50 hover:text-[#2563eb] focus:outline-none focus:ring-2 focus:ring-blue-900" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>}
          </FormField>

          <InlineFeedback>{error}</InlineFeedback>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 min-h-12 w-full rounded-xl bg-[#F5B700] px-5 py-3 text-sm font-bold text-[#0B1F3A] shadow-sm transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? 'Signing in...' : 'Log In'}
          </button>

          <div className="text-center">
            {administratorOnly ? (
              <Link
                to="/"
                className="text-xs font-semibold text-[#718096] transition hover:text-[#2563eb]"
              >
                Return to User Login
              </Link>
            ) : (
              <Link
                to="/admin/login"
                className="text-xs font-semibold text-[#718096] transition hover:text-[#2563eb]"
              >
                Administrator Login
              </Link>
            )}
          </div>
        </form>

        <p className="mt-4 text-center text-xs text-[#718096]">Use the username assigned to your account.</p>

        <div className="mt-7 flex items-center justify-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9aa8b8]">
          <span className="h-px w-8 bg-[#e5ebf2]" />
          Secure access for TapTrack users
          <span className="h-px w-8 bg-[#e5ebf2]" />
        </div>
      </section>
    </main>
  )
}
