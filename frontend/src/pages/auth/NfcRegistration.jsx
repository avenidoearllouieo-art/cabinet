import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import api from '../../services/api'
import { getRegistrationSubmissionError, getRegistrationValidationError } from './registrationErrors'

const MISSING_TOKEN_MESSAGE = 'Please tap your ID card at the TapTrack Cabinet first.'
const fieldClass = 'min-h-12 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-lg text-slate-900 outline-none focus:border-[#082B53] focus:ring-2 focus:ring-[#082B53]/20 disabled:bg-slate-100'

export default function NfcRegistration() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim()
  const [state, setState] = useState(() => ({ status: token ? 'loading' : 'missing', error: '' }))
  const [expiresAt, setExpiresAt] = useState(null)
  const [secondsRemaining, setSecondsRemaining] = useState(null)
  const [form, setForm] = useState({ id_number: '', email: '', username: '', password: '', confirm_password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!token) return undefined

    api.get('/cabinet/enrollment/validate/', { params: { token } })
      .then((response) => {
        if (cancelled) return
        if (!response.data.valid) {
          setState({ status: 'invalid', error: response.data.error || 'This registration session has expired or is no longer valid.' })
          return
        }
        setExpiresAt(response.data.completion_expires_at || response.data.expires_at)
        setState({ status: 'valid', error: '' })
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'invalid', error: getRegistrationValidationError(error) })
      })

    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!expiresAt) return undefined
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setSecondsRemaining(remaining)
      if (remaining === 0) setState({ status: 'invalid', error: 'Registration session expired. Please return to the cabinet and tap your ID card again.' })
    }
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [expiresAt])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function submitRegistration(event) {
    event.preventDefault()
    if (!form.id_number.trim() || !form.email.trim() || !form.username.trim() || !form.password || !form.confirm_password) {
      setState((current) => ({ ...current, error: 'Complete all registration fields.' }))
      return
    }
    if (form.password !== form.confirm_password) {
      setState((current) => ({ ...current, error: 'Password and confirmation do not match.' }))
      return
    }
    if (busy) return
    setBusy(true)
    setState((current) => ({ ...current, error: '' }))
    try {
      const response = await api.post('/cabinet/enrollment/register/', {
        token,
        id_number: form.id_number.trim(),
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        confirm_password: form.confirm_password,
      })
      setResult(response.data)
      setState({ status: 'completed', error: '' })
    } catch (error) {
      setState((current) => ({ ...current, error: getRegistrationSubmissionError(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#F3F6FA] px-4 py-6 text-slate-900 sm:px-6 sm:py-10">
      <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-lg border border-[#d6e0ec] bg-white shadow-sm">
        <header className="border-b-4 border-[#FFBE0B] bg-[#082B53] px-5 py-5 text-white sm:px-8">
          <p className="text-xs font-bold uppercase">TapTrack</p>
          <h1 className="mt-1 text-xl font-bold sm:text-2xl">Complete Your Registration</h1>
        </header>
        <div className="space-y-6 p-5 sm:p-8">
          {state.status === 'loading' && <p className="text-base font-semibold" role="status">Checking NFC registration session...</p>}
          {state.status === 'missing' && (
            <>
              <h2 className="text-lg font-bold">NFC registration required</h2>
              <p className="leading-7 text-slate-600">{MISSING_TOKEN_MESSAGE}</p>
            </>
          )}
          {state.status === 'invalid' && (
            <>
              <h2 className="text-lg font-bold">Registration Expired</h2>
              <p className="leading-7 text-slate-600">{state.error || 'Registration session expired. Please return to the cabinet and tap your ID card again.'}</p>
              <button type="button" className="min-h-14 w-full rounded-md bg-[#082B53] px-5 py-3 text-lg font-bold text-white" onClick={() => window.history.back()}>
                Back to Card Tapping
              </button>
            </>
          )}
          {state.status === 'valid' && (
            <>
              {secondsRemaining !== null && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="timer">
                  Registration session: {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, '0')}
                </p>
              )}
              {state.error && <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{state.error}</p>}
              <form className="grid gap-5" onSubmit={submitRegistration}>
                <p className="text-base leading-7 text-slate-600">Verify your identity and create your TapTrack account.</p>
                <section className="grid gap-5" aria-labelledby="identity-title">
                  <h2 id="identity-title" className="text-lg font-bold text-[#082B53]">Identity Information</h2>
                  <label className="grid gap-2 text-base font-semibold">
                    ID Number
                    <input name="id_number" className={fieldClass} value={form.id_number} onChange={updateField} placeholder="Enter your authorized ID number" autoComplete="off" required />
                  </label>
                  <label className="grid gap-2 text-base font-semibold">
                    Email Address
                    <input name="email" type="email" inputMode="email" className={fieldClass} value={form.email} onChange={updateField} placeholder="Enter your registered email address" autoComplete="email" required />
                  </label>
                </section>

                <section className="grid gap-5" aria-labelledby="credentials-title">
                  <h2 id="credentials-title" className="text-lg font-bold text-[#082B53]">Account Credentials</h2>
                  <label className="grid gap-2 text-base font-semibold">
                    Username
                    <input name="username" className={fieldClass} value={form.username} onChange={updateField} placeholder="Create your username" autoComplete="username" maxLength={150} required />
                  </label>
                  <label className="grid gap-2 text-base font-semibold">
                    Password
                    <div className="relative">
                      <input name="password" type={showPassword ? 'text' : 'password'} className={`${fieldClass} pr-14`} value={form.password} onChange={updateField} placeholder="Create a strong password" autoComplete="new-password" minLength={8} required />
                      <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-[#082B53]">
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </label>
                  <label className="grid gap-2 text-base font-semibold">
                    Confirm Password
                    <div className="relative">
                      <input name="confirm_password" type={showConfirmPassword ? 'text' : 'password'} className={`${fieldClass} pr-14`} value={form.confirm_password} onChange={updateField} placeholder="Re-enter your password" autoComplete="new-password" minLength={8} required />
                      <button type="button" aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} onClick={() => setShowConfirmPassword((value) => !value)} className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-[#082B53]">
                        {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </label>
                  <p className="text-sm leading-6 text-slate-600">Use at least 8 characters, including uppercase, lowercase, a number, and a symbol.</p>
                </section>
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Only complete registration for an account and ID card assigned to you.</p>
                <button className="min-h-14 w-full rounded-md bg-[#082B53] px-5 py-3 text-lg font-bold text-white disabled:opacity-50" type="submit" disabled={busy || secondsRemaining === 0}>
                  {busy ? 'Registering...' : 'Complete Registration'}
                </button>
              </form>
            </>
          )}
          {state.status === 'completed' && (
            <section className="space-y-4" aria-labelledby="success-title">
              <div className="border-l-4 border-[#FFBE0B] bg-[#EAF2FB] p-4">
                <h2 id="success-title" className="text-2xl font-bold text-[#082B53]">Registration Successful</h2>
                <p className="mt-1 text-base text-slate-700">Your TapTrack account has been created and your ID card is now registered.</p>
              </div>
              <dl className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-2">
                <ReadOnlyItem label="Account Name" value={result?.name} />
                <ReadOnlyItem label="Role" value={result?.role} capitalize />
                <ReadOnlyItem label={result?.role === 'instructor' ? 'Instructor ID' : 'Student ID'} value={result?.instructor_id || result?.student_id} />
                <ReadOnlyItem label="NFC Card" value={result?.nfc_registered ? 'Registered' : 'Not confirmed'} />
              </dl>
              <button type="button" className="min-h-14 w-full rounded-md bg-[#082B53] px-5 py-3 text-lg font-bold text-white" onClick={() => window.location.assign('/login')}>
                Continue to Login
              </button>
            </section>
          )}
        </div>
      </section>
    </main>
  )
}

function ReadOnlyItem({ label, value, capitalize = false }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase text-slate-600">{label}</dt><dd className={`mt-1 break-words font-medium text-slate-900 ${capitalize ? 'capitalize' : ''}`}>{value || 'Not provided'}</dd></div>
}