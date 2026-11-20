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
  const [idType, setIdType] = useState('')
  const [form, setForm] = useState({ id_number: '', email: '', username: '', password: '', registration_pin: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [pinStep, setPinStep] = useState(false)
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

  function updateIdType(nextType) {
    setIdType(nextType)
    setForm((current) => ({ ...current, id_number: '' }))
    setPinStep(false)
    setState((current) => ({ ...current, error: '' }))
  }

  function continueToPin(event) {
    event.preventDefault()
    if (!idType || !form.id_number.trim() || !form.email.trim() || !form.username.trim() || !form.password) return
    setPinStep(true)
  }

  async function submitRegistration(event) {
    event.preventDefault()
    if (!pinStep) {
      continueToPin(event)
      return
    }
    setBusy(true)
    setState((current) => ({ ...current, error: '' }))
    try {
      const response = await api.post('/cabinet/enrollment/register/', {
        token,
        id_type: idType === 'administrator' ? 'administrator' : idType,
        id_number: form.id_number.trim(),
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        registration_pin: form.registration_pin,
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
                <section aria-labelledby="id-type-title" className="space-y-3">
                  <h2 id="id-type-title" className="text-lg font-bold text-[#082B53]">Select Your ID Type</h2>
                  <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <legend className="sr-only">ID type</legend>
                    {[
                      ['student', 'Student ID'],
                      ['instructor', 'Instructor ID'],
                      ['administrator', 'Administrator ID'],
                    ].map(([value, label]) => (
                      <label key={value} className={`flex min-h-16 cursor-pointer items-center justify-center rounded-md border px-3 py-3 text-center text-base font-bold ${idType === value ? 'border-[#082B53] bg-[#EAF2FB] text-[#082B53]' : 'border-slate-300 bg-white'}`}>
                        <input type="radio" name="id_type" value={value} checked={idType === value} onChange={() => updateIdType(value)} className="sr-only" />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                </section>

                {idType && !pinStep && (
                  <>
                    <label className="grid gap-2 text-base font-semibold">
                      {idType === 'student' ? 'Student ID Number' : idType === 'instructor' ? 'Instructor ID Number' : 'Administrator ID Number'}
                      <input name="id_number" className={fieldClass} value={form.id_number} onChange={updateField} placeholder={idType === 'student' ? 'Enter your student ID number' : idType === 'instructor' ? 'Enter your instructor ID number' : 'Enter your administrator ID number'} required />
                    </label>
                    <label className="grid gap-2 text-base font-semibold">
                      Email Address
                      <input name="email" type="email" className={fieldClass} value={form.email} onChange={updateField} placeholder="Enter your registered email address" autoComplete="email" required />
                    </label>
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
                    <p className="text-sm leading-6 text-slate-600">Use at least 8 characters, including uppercase, lowercase, a number, and a symbol.</p>
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Only register an ID card that belongs to you.</p>
                    <button className="min-h-14 w-full rounded-md bg-[#082B53] px-5 py-3 text-lg font-bold text-white disabled:opacity-50" type="submit" disabled={busy || secondsRemaining === 0}>
                      Continue with Private PIN
                    </button>
                  </>
                )}

                {pinStep && (
                  <section className="grid gap-4 rounded-md border border-[#d6e0ec] bg-[#F8FAFC] p-4" aria-labelledby="pin-title">
                    <h2 id="pin-title" className="text-lg font-bold text-[#082B53]">Private Registration PIN</h2>
                    <p className="text-sm leading-6 text-slate-600">Enter the PIN issued privately by an authorized administrator. It is never included in this QR code.</p>
                    <label className="grid gap-2 text-base font-semibold">
                      Registration PIN
                      <input name="registration_pin" type="password" inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} className={fieldClass} value={form.registration_pin} onChange={updateField} autoComplete="one-time-code" required />
                    </label>
                    <button className="min-h-14 w-full rounded-md bg-[#082B53] px-5 py-3 text-lg font-bold text-white disabled:opacity-50" type="submit" disabled={busy || secondsRemaining === 0}>
                      {busy ? 'Registering...' : 'Complete Registration'}
                    </button>
                    <button type="button" className="min-h-11 text-base font-semibold text-[#082B53]" onClick={() => setPinStep(false)}>Back to account details</button>
                  </section>
                )}
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