import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../services/api'

const MISSING_TOKEN_MESSAGE = 'Please tap your NFC card at the TapTrack Cabinet first.'
const INVALID_SESSION_MESSAGE = 'This registration link is invalid or has expired. Please tap your NFC card at the TapTrack Cabinet again.'

export default function NfcRegistration() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim()
  const [state, setState] = useState(() => ({ status: token ? 'loading' : 'missing', expiresAt: '', error: '' }))
  const [form, setForm] = useState({ student_id: '', full_name: '', email: '', password: '', confirm_password: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (!token) {
      return undefined
    }

    api.get('/cabinet/enrollment/validate/', { params: { token } })
      .then((response) => {
        if (!cancelled) setState({ status: response.data.valid ? 'valid' : 'invalid', expiresAt: response.data.expires_at || '', error: response.data.valid ? '' : INVALID_SESSION_MESSAGE })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'invalid', expiresAt: '', error: INVALID_SESSION_MESSAGE })
      })

    return () => { cancelled = true }
  }, [token])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function submitRegistration(event) {
    event.preventDefault()
    setSubmitting(true)
    setState((current) => ({ ...current, error: '' }))
    try {
      const response = await api.post('/cabinet/enrollment/register/', { ...form, token })
      setState({ status: 'completed', expiresAt: '', error: response.data.message || '' })
    } catch (error) {
      const payload = error.response?.data
      const message = payload?.error || payload?.detail || 'Registration could not be completed. Please check your details and try again.'
      setState((current) => ({ ...current, error: message }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 py-12 text-slate-900">
      <section className="w-full max-w-lg rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        {state.status === 'loading' && <p className="text-lg font-semibold">Checking NFC registration session...</p>}
        {state.status === 'missing' && (
          <>
            <h1 className="text-2xl font-bold">NFC registration required</h1>
            <p className="mt-4 leading-7 text-slate-600">{MISSING_TOKEN_MESSAGE}</p>
          </>
        )}
        {state.status === 'invalid' && (
          <>
            <h1 className="text-2xl font-bold">NFC registration unavailable</h1>
            <p className="mt-4 leading-7 text-slate-600">{INVALID_SESSION_MESSAGE}</p>
          </>
        )}
        {state.status === 'valid' && (
          <>
            <h1 className="text-2xl font-bold">Register your NFC card</h1>
            <p className="mt-3 leading-7 text-slate-600">This form is available because you tapped an unregistered NFC card at the TapTrack Cabinet.</p>
            {state.error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-left text-sm text-red-700">{state.error}</p>}
            <form className="mt-6 grid gap-4 text-left" onSubmit={submitRegistration}>
              <label className="grid gap-1 text-sm font-semibold">
                Student ID
                <input className="rounded-xl border border-slate-300 px-3 py-3" name="student_id" value={form.student_id} onChange={updateField} required />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Full name
                <input className="rounded-xl border border-slate-300 px-3 py-3" name="full_name" value={form.full_name} onChange={updateField} required />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Email
                <input className="rounded-xl border border-slate-300 px-3 py-3" type="email" name="email" value={form.email} onChange={updateField} required />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Password
                <input className="rounded-xl border border-slate-300 px-3 py-3" type="password" name="password" minLength="8" value={form.password} onChange={updateField} required />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Confirm password
                <input className="rounded-xl border border-slate-300 px-3 py-3" type="password" name="confirm_password" minLength="8" value={form.confirm_password} onChange={updateField} required />
              </label>
              <button className="rounded-xl bg-[#002B5B] px-4 py-3 font-bold text-white disabled:opacity-50" type="submit" disabled={submitting}>
                {submitting ? 'Registering...' : 'Register NFC card'}
              </button>
            </form>
          </>
        )}
        {state.status === 'completed' && (
          <>
            <h1 className="text-2xl font-bold">Registration successful.</h1>
            <p className="mt-4 leading-7 text-slate-600">Your NFC card is now linked to your TapTrack account.</p>
            <p className="mt-2 leading-7 text-slate-600">Please return to the TapTrack Cabinet and tap your NFC card.</p>
          </>
        )}
      </section>
    </main>
  )
}
