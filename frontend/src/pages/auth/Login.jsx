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

    if (isSubmitting) return

    const trimmedUsername = username.trim()
    if (!trimmedUsername || !password) {
      setError(
        !trimmedUsername && !password
          ? 'Enter your username and password.'
          : !trimmedUsername
            ? 'Enter your username.'
            : 'Enter your password.',
      )
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
        setError('We could not verify your account. Please try again.')
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
      setError(
        loginError.response?.status === 429
          ? 'Too many sign-in attempts. Please wait a moment and try again.'
          : loginError.response
            ? 'Invalid username or password. Please try again.'
            : 'Unable to reach TapTrack. Check your connection and try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-6 sm:px-6 sm:py-8">
      <div className="login-grid absolute inset-0" aria-hidden="true" />
      <div className="login-wordmark-pattern" aria-hidden="true" />
      <div className="login-cabinet-mark absolute left-1/2 top-8 hidden -translate-x-1/2 md:block" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <section className="login-card relative z-10 w-full max-w-[430px] rounded-[22px] bg-white px-5 py-6 shadow-[0_22px_70px_rgba(0,43,91,0.14)] sm:px-9 sm:py-8">
        <div className="mb-6 text-center">
          <TapTrackLogo compact className="login-logo mx-auto mb-4 h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]" />
          <h1 className="text-2xl font-bold tracking-tight text-[#002B5B]">
            {administratorOnly ? 'Administrator Portal' : 'Welcome back'}
          </h1>
          <p className="mx-auto mt-2 max-w-[300px] text-sm leading-5 text-[#5C6F84]">
            {administratorOnly
              ? 'Sign in to manage the TapTrack system'
              : 'Sign in to access your TapTrack cabinet'}
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
          <FormField label="Username" required>
            {({ id }) => (
              <div className="login-field flex min-h-12 items-center gap-3 rounded-xl border border-[#dbe3ed] bg-white px-4 py-2.5 transition duration-200 ease-out focus-within:border-[#F3CA4D] focus-within:shadow-[0_0_0_3px_rgba(255,193,7,0.12)]">
                <UserRound size={18} className="shrink-0 text-[#8291a5]" aria-hidden="true" />
                <input
                  id={id}
                  type="text"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value)
                    setError('')
                  }}
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
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setError('')
                    }}
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
              <Link to="/forgot-password" className="text-xs font-medium text-[#607087] transition hover:text-[#002B5B] active:text-[#1E4D8C] focus-visible:outline-none focus-visible:underline focus-visible:underline-offset-4">
                Forgot password?
              </Link>
            </div>
          </div>

          <InlineFeedback role="alert">{error}</InlineFeedback>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-1 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FFC107] px-5 py-3 text-sm font-bold text-[#002B5B] shadow-[0_8px_20px_rgba(255,193,7,0.28)] transition hover:bg-[#E0A800] active:translate-y-px active:bg-[#D99F00] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#002B5B]/30 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#002B5B]/25 border-t-[#002B5B]" aria-hidden="true" />
                <span>Logging in...</span>
              </>
            ) : (
              administratorOnly ? 'Log In as Administrator' : 'Log In'
            )}
          </button>

          <div className="pt-0 text-center">
            {administratorOnly ? (
              <Link
                to="/"
                className="inline-flex min-h-8 items-center justify-center text-sm font-semibold text-[#002B5B] transition hover:text-[#1E4D8C] active:text-[#163C70] focus-visible:outline-2 focus-visible:outline-[#F3CA4D] focus-visible:outline-offset-2 focus-visible:underline focus-visible:underline-offset-4"
              >
                <span>← Return to User Login</span>
              </Link>
            ) : (
              <Link
                to="/admin/login"
                className="inline-flex min-h-8 items-center justify-center text-sm font-semibold text-[#002B5B] transition hover:text-[#1E4D8C] active:text-[#163C70] focus-visible:outline-2 focus-visible:outline-[#F3CA4D] focus-visible:outline-offset-2 focus-visible:underline focus-visible:underline-offset-4"
              >
                <span>Administrator Login →</span>
              </Link>
            )}
          </div>
        </form>

        <div className="mt-4 border-t border-[#E7EDF5] pt-3 text-center text-[11px] text-[#8A9BB0]">
          © 2026 TapTrack
        </div>
      </section>
    </main>
  )
}
