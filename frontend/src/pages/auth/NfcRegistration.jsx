import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../services/api'
import { getRegistrationSubmissionError, getRegistrationValidationError } from './registrationErrors'
import { NFC_REGISTRATION_FIELDS } from './registrationForm'

const MISSING_TOKEN_MESSAGE = 'Please tap your NFC card at the TapTrack Cabinet first.'
const fieldClass = 'min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-[#082B53] focus:ring-2 focus:ring-[#082B53]/20 disabled:bg-slate-100'

export default function NfcRegistration() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim()
  const [state, setState] = useState(() => ({ status: token ? 'loading' : 'missing', error: '' }))
  const [role, setRole] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [form, setForm] = useState({ username: '', password: '', confirm_password: '' })
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!token) return undefined

    api.get('/cabinet/enrollment/validate/', { params: { token } })
      .then((response) => {
        if (!cancelled) setState({
          status: response.data.valid ? 'valid' : 'invalid',
          error: response.data.valid ? '' : response.data.error || 'TapTrack could not validate this registration link.',
        })
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'invalid', error: getRegistrationValidationError(error) })
      })

    return () => { cancelled = true }
  }, [token])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  function updateRole(event) {
    setRole(event.target.value)
    setIdentifier('')
    setState((current) => ({ ...current, error: '' }))
  }

  async function submitRegistration(event) {
    event.preventDefault()
    setBusy(true)
    setState((current) => ({ ...current, error: '' }))
    const identifierField = role === 'student' ? 'student_id' : 'instructor_id'

    try {
      const response = await api.post('/cabinet/enrollment/register/', {
        token,
        role,
        [identifierField]: identifier.trim(),
        ...form,
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
          <h1 className="mt-1 text-xl font-bold sm:text-2xl">NFC Card Registration</h1>
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
              <h2 className="text-lg font-bold">NFC registration unavailable</h2>
              <p className="leading-7 text-slate-600">{state.error}</p>
            </>
          )}
          {state.status === 'valid' && (
            <>
              <p className="leading-7 text-slate-600">Register the unassigned NFC card to your existing TapTrack account.</p>
              {state.error && <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{state.error}</p>}
              <form className="grid gap-4" onSubmit={submitRegistration}>
                <section aria-labelledby="role-step-title" className="space-y-3">
                  <h2 id="role-step-title" className="text-base font-bold text-[#082B53]">Register As</h2>
                  <fieldset className="grid grid-cols-2 gap-3">
                    <legend className="sr-only">Role</legend>
                    {['student', 'instructor'].map((option) => (
                      <label key={option} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-md border px-3 py-3 font-semibold capitalize ${role === option ? 'border-[#082B53] bg-[#EAF2FB] text-[#082B53]' : 'border-slate-300'}`}>
                        <input type="radio" name="role" value={option} checked={role === option} onChange={updateRole} required />
                        {option}
                      </label>
                    ))}
                  </fieldset>
                </section>

                {role && (
                  <label className="grid gap-1 text-sm font-semibold">
                    {role === 'student' ? 'Student ID' : 'Instructor ID'}
                    <input
                      className={fieldClass}
                      autoComplete="off"
                      maxLength={50}
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      required
                    />
                  </label>
                )}

                {NFC_REGISTRATION_FIELDS.map((field) => (
                  <label className="grid gap-1 text-sm font-semibold" key={field.name}>
                    {field.label}
                    <input
                      className={fieldClass}
                      autoComplete={field.autoComplete}
                      maxLength={field.maxLength}
                      minLength={field.minLength}
                      name={field.name}
                      type={field.type}
                      value={form[field.name]}
                      onChange={updateField}
                      required
                    />
                  </label>
                ))}

                <button className="min-h-12 w-full rounded-md bg-[#082B53] px-4 py-3 font-bold text-white hover:bg-[#123e6b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFBE0B] disabled:opacity-50" type="submit" disabled={busy || !role || !identifier.trim()}>
                  {busy ? 'Registering...' : 'Register NFC Card'}
                </button>
              </form>
            </>
          )}
          {state.status === 'completed' && (
            <section className="space-y-4" aria-labelledby="success-title">
              <div className="border-l-4 border-[#FFBE0B] bg-[#EAF2FB] p-4">
                <h2 id="success-title" className="text-xl font-bold text-[#082B53]">NFC Registration Successful</h2>
                <p className="mt-1 text-sm text-slate-700">Django confirmed that the NFC card was linked to this account.</p>
              </div>
              <dl className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-2">
                <ReadOnlyItem label="Account Name" value={result?.name} />
                <ReadOnlyItem label="Role" value={result?.role} capitalize />
                <ReadOnlyItem label={result?.role === 'instructor' ? 'Instructor ID' : 'Student ID'} value={result?.instructor_id || result?.student_id} />
                <ReadOnlyItem label="NFC Card" value={result?.nfc_registered ? 'Registered' : 'Not confirmed'} />
              </dl>
              <button type="button" className="min-h-11 rounded-md bg-[#082B53] px-5 py-2.5 font-bold text-white hover:bg-[#123e6b]" onClick={() => window.history.back()}>
                Back to Cabinet
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