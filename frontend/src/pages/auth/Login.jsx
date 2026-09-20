import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react'
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

    if (isSubmitting) return

    const trimmedUsername = username.trim()
    if (!trimmedUsername || !password) {
      setError('Invalid username or password. Please try again.')
      return
    }

    setError('')
    setIsSubmitting(true)

    try {
      const response = await api.post('/auth/login/', {
        username: trimmedUsername,
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
        'Invalid username or password. Please try again.'
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

      <section className="login-card relative z-10 w-full max-w-[430px] rounded-[22px] bg-white px-5 py-8 shadow-[0_22px_70px_rgba(0,43,91,0.14)] sm:px-9 sm:py-10">
        <div className="mb-8 text-center">
          <TapTrackLogo compact className="mx-auto mb-5 h-20 w-20" />
          <h1 className="text-2xl font-bold tracking-tight text-[#002B5B]">Welcome back</h1>
          <p className="mx-auto mt-3 max-w-[300px] text-sm leading-5 text-[#5C6F84]">
            TapTrack Cabinet Activity and User Management System
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <FormField label="Username" required>
            {({ id }) => (
              <div className="login-field flex min-h-12 items-center gap-3 rounded-xl border border-[#dbe3ed] bg-white px-4 py-2.5 transition duration-200 ease-out focus-within:border-[#F3CA4D] focus-within:shadow-[0_0_0_3px_rgba(255,193,7,0.12)]">
                <UserRound size={18} className="shrink-0 text-[#8291a5]" aria-hidden="true" />
                <input
                  id={id}
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#14243a] outline-none placeholder:text-[#9aa8b8]"
                  placeholder="Enter your assigned username"
                  autoComplete="username"
                  required
                />
              </div>
            )}
          </FormField>

          <div className="space-y-2">
            <FormField label="Password" required>
              {({ id }) => (
                <div className="login-field flex min-h-12 items-center gap-3 rounded-xl border border-[#dbe3ed] bg-white px-4 py-1 transition duration-200 ease-out focus-within:border-[#F3CA4D] focus-within:shadow-[0_0_0_3px_rgba(255,193,7,0.12)]">
                  <LockKeyhole size={18} className="shrink-0 text-[#8291a5]" aria-hidden="true" />
                  <input
                    id={id}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#14243a] outline-none placeholder:text-[#9aa8b8]"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8291a5] transition hover:bg-[#EEF4FA] hover:text-[#002B5B] focus:outline-none focus:ring-2 focus:ring-[#FFC107]/60"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              )}
            </FormField>

            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-xs font-medium text-[#607087] transition hover:text-[#002B5B]">
                Forgot password?
              </Link>
            </div>
          </div>

          <InlineFeedback role="alert">{error}</InlineFeedback>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FFC107] px-5 py-3 text-sm font-bold text-[#002B5B] shadow-[0_8px_20px_rgba(255,193,7,0.28)] transition hover:bg-[#E0A800] focus:outline-none focus:ring-2 focus:ring-[#002B5B]/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#002B5B]/25 border-t-[#002B5B]" aria-hidden="true" />
                <span>Logging in...</span>
              </>
            ) : (
              'Log In'
            )}
          </button>

          <div className="pt-1 text-center">
            {administratorOnly ? (
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-1 text-sm font-semibold text-[#002B5B] transition hover:text-[#1E4D8C]"
              >
                <span>Return to User Login</span>
              </Link>
            ) : (
              <Link
                to="/admin/login"
                className="inline-flex items-center justify-center gap-1 text-sm font-semibold text-[#002B5B] transition hover:text-[#1E4D8C]"
              >
                <span>Administrator Login</span>
                <ArrowRight size={15} />
              </Link>
            )}
          </div>
        </form>

        <div className="mt-6 border-t border-[#E7EDF5] pt-4 text-center text-[11px] text-[#8A9BB0]">
          © 2026 TapTrack
        </div>
      </section>
    </main>
  )
}
