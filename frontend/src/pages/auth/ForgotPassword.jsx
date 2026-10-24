import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, KeyRound, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import TapTrackLogo from '../../components/TapTrackLogo.jsx'
import { FormField, InlineFeedback, PasswordField } from '../../components/forms/FormPrimitives.jsx'

const steps = ['Account details', 'Cabinet verification', 'New password']
const STATUS_POLL_INTERVAL_MS = 2500

function getApiError(error, fallback) {
  const status = error.response?.status
  if (status === 410) return 'This reset request or token has expired. Start again to create a new request.'
  if (status === 409) return 'This reset request or authorization has already been used. Start again to create a new request.'
  if (status === 429) return 'Too many reset attempts. Please wait before trying again.'
  if (status === 400 || status === 404) {
    return error.response?.data?.error || 'The reset details could not be verified. Check them and try again.'
  }
  return fallback
}

function StepIndicator({ currentStep }) {
  return (
    <div className="mb-7 flex items-center gap-2" aria-label="Password reset progress">
      {steps.map((step, index) => (
        <div key={step} className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${index <= currentStep ? 'bg-[#002B5B] text-white' : 'border border-[#cbd7e5] bg-white text-[#718096]'}`}>
            {index + 1}
          </span>
          <span className={`hidden truncate text-xs font-semibold sm:block ${index <= currentStep ? 'text-[#002B5B]' : 'text-[#718096]'}`}>{step}</span>
          {index < steps.length - 1 && <span className={`h-px min-w-2 flex-1 ${index < currentStep ? 'bg-[#002B5B]' : 'bg-[#dbe3ed]'}`} aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
}

function ResetShell({ currentStep, title, description, children }) {
  return (
    <main className="login-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6">
      <div className="login-grid absolute inset-0" aria-hidden="true" />
      <div className="login-wordmark-pattern" aria-hidden="true" />
      <div className="login-cabinet-mark absolute left-1/2 top-8 hidden -translate-x-1/2 md:block" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <section className="login-card relative z-10 w-full max-w-[500px] rounded-[22px] bg-white px-5 py-8 shadow-[0_22px_70px_rgba(0,43,91,0.14)] sm:px-9 sm:py-10">
        <div className="mb-7 text-center">
          <TapTrackLogo compact className="mx-auto mb-5 h-20 w-20" />
          <h1 className="text-2xl font-bold tracking-tight text-[#002B5B]">{title}</h1>
          <p className="mx-auto mt-3 max-w-[360px] text-sm leading-5 text-[#5C6F84]">{description}</p>
        </div>
        <StepIndicator currentStep={currentStep} />
        {children}
        <div className="mt-7 border-t border-[#E7EDF5] pt-4 text-center text-[11px] text-[#8A9BB0]">© 2026 TapTrack</div>
      </section>
    </main>
  )
}

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [requestId, setRequestId] = useState('')
  const [requestExpiresAt, setRequestExpiresAt] = useState('')
  const [resetAuthorization, setResetAuthorization] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [verificationEnded, setVerificationEnded] = useState(false)
  const pollingRef = useRef(false)

  const checkVerificationStatus = useCallback(async (isActive = () => true) => {
    if (!requestId || pollingRef.current || verificationEnded) return

    pollingRef.current = true
    setIsCheckingStatus(true)
    try {
      const response = await api.post('/auth/password-reset/status/', { request_id: requestId })
      const { status: responseStatus, reset_authorization: authorization } = response.data || {}
      const status = typeof responseStatus === 'string' ? responseStatus.trim().toLowerCase() : ''
      if (!isActive()) return

      if (status === 'pending' || status === 'pending_cabinet_verification') {
        setError('')
        setSuccess('Waiting for the cabinet to verify your registered NFC card...')
        return
      }

      if (status === 'verified') {
        if (typeof authorization !== 'string' || !authorization) {
          setError('Cabinet verification was reported without reset authorization. Start again or contact support.')
          setSuccess('')
          setVerificationEnded(true)
          return
        }
        setError('')
        setSuccess('Cabinet verification completed. You can now create a new password.')
        setResetAuthorization(authorization)
        setStep(2)
        return
      }

      const terminalErrors = {
        expired: 'This reset request has expired. Start again to create a new request.',
        cancelled: 'This reset request was cancelled. Start again to create a new request.',
        used: 'This reset request has already been used. Start again to create a new request.',
        rejected: 'Cabinet verification was rejected. Start again or contact support.',
      }
      const statusError = Object.hasOwn(terminalErrors, status)
        ? terminalErrors[status]
        : 'The reset request returned an unexpected status. Start again or contact support.'
      setError(statusError)
      setSuccess('')
      setVerificationEnded(true)
    } catch {
      if (isActive()) {
        setError('We could not check cabinet verification status. We will keep trying; you can also check again.')
        setSuccess('')
      }
    } finally {
      pollingRef.current = false
      if (isActive()) setIsCheckingStatus(false)
    }
  }, [requestId, verificationEnded])

  useEffect(() => {
    if (step !== 1 || !requestId || verificationEnded) return undefined

    let active = true
    const isActive = () => active
    const initialCheckId = window.setTimeout(() => {
      void checkVerificationStatus(isActive)
    }, 0)
    const intervalId = window.setInterval(() => {
      void checkVerificationStatus(isActive)
    }, STATUS_POLL_INTERVAL_MS)

    return () => {
      active = false
      window.clearTimeout(initialCheckId)
      window.clearInterval(intervalId)
    }
  }, [checkVerificationStatus, requestId, step, verificationEnded])

  const handleRequest = async (event) => {
    event.preventDefault()
    if (isSubmitting) return

    const trimmedStudentId = studentId.trim()
    const trimmedEmail = email.trim()
    if (!trimmedStudentId || !trimmedEmail) {
      setError('Enter both your Student ID and email address.')
      return
    }

    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      const response = await api.post('/auth/password-reset/request/', {
        student_id: trimmedStudentId,
        email: trimmedEmail,
      })
      const nextRequestId = response.data.request_id || ''
      if (!nextRequestId) throw new Error('The reset request did not include a request ID.')
      setRequestId(nextRequestId)
      setRequestExpiresAt(response.data.expires_at || '')
      setVerificationEnded(false)
      setSuccess('Your recovery reference is ready. Enter it on the Cabinet UI, then tap your registered NFC card.')
      setStep(1)
    } catch (requestError) {
      setError(getApiError(requestError, 'We could not start the password reset. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePasswordReset = async (event) => {
    event.preventDefault()
    if (isSubmitting) return

    if (newPassword.length < 8) {
      setError('Your new password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }
    if (!requestId || !resetAuthorization) {
      setError('Your reset authorization is no longer available. Start the process again.')
      setStep(0)
      return
    }

    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      await api.post('/auth/password-reset/confirm/', {
        request_id: requestId,
        reset_authorization: resetAuthorization,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
      setResetAuthorization('')
      setRequestId('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess('Your password has been changed successfully. You can now log in with your new password.')
    } catch (resetError) {
      setError(getApiError(resetError, 'We could not change your password. Please start the reset process again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const startOver = () => {
    setStep(0)
    setRequestId('')
    setRequestExpiresAt('')
    setResetAuthorization('')
    setVerificationEnded(false)
    setError('')
    setSuccess('')
  }

  if (success && !resetAuthorization && !requestId && !newPassword && !confirmPassword) {
    return (
      <ResetShell currentStep={2} title="Password changed" description="Your TapTrack password has been updated.">
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><ShieldCheck size={32} aria-hidden="true" /></div>
          <InlineFeedback type="success">{success}</InlineFeedback>
          <button type="button" onClick={() => navigate('/')} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FFC107] px-5 py-3 text-sm font-bold text-[#002B5B] shadow-[0_8px_20px_rgba(255,193,7,0.28)] transition hover:bg-[#E0A800] focus:outline-none focus:ring-2 focus:ring-[#002B5B]/20">Return to Login <ArrowRight size={16} /></button>
        </div>
      </ResetShell>
    )
  }

  if (step === 0) {
    return (
      <ResetShell currentStep={0} title="Forgot password?" description="Start with the Student ID and email connected to your TapTrack account.">
        <form className="space-y-5" onSubmit={handleRequest} noValidate>
          <FormField label="Student ID" required>
            {({ id, describedBy }) => (
              <div className="login-field flex min-h-12 items-center gap-3 rounded-xl border border-[#dbe3ed] bg-white px-4 py-2.5 transition duration-200 ease-out focus-within:border-[#F3CA4D] focus-within:shadow-[0_0_0_3px_rgba(255,193,7,0.12)]">
                <UserRound size={18} className="shrink-0 text-[#8291a5]" aria-hidden="true" />
                <input id={id} type="text" value={studentId} onChange={(event) => setStudentId(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-[#14243a] outline-none placeholder:text-[#9aa8b8]" placeholder="Enter your Student ID" autoComplete="username" aria-describedby={describedBy} required />
              </div>
            )}
          </FormField>
          <FormField label="Email" required>
            {({ id, describedBy }) => (
              <div className="login-field flex min-h-12 items-center gap-3 rounded-xl border border-[#dbe3ed] bg-white px-4 py-2.5 transition duration-200 ease-out focus-within:border-[#F3CA4D] focus-within:shadow-[0_0_0_3px_rgba(255,193,7,0.12)]">
                <Mail size={18} className="shrink-0 text-[#8291a5]" aria-hidden="true" />
                <input id={id} type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-[#14243a] outline-none placeholder:text-[#9aa8b8]" placeholder="Enter your account email" autoComplete="email" aria-describedby={describedBy} required />
              </div>
            )}
          </FormField>
          <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-5 text-[#31577f]">Entering these details only starts a request. Your identity must still be verified by tapping your registered NFC card at the cabinet.</p>
          <InlineFeedback>{error}</InlineFeedback>
          <button type="submit" disabled={isSubmitting} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FFC107] px-5 py-3 text-sm font-bold text-[#002B5B] shadow-[0_8px_20px_rgba(255,193,7,0.28)] transition hover:bg-[#E0A800] focus:outline-none focus:ring-2 focus:ring-[#002B5B]/20 disabled:cursor-not-allowed disabled:opacity-70">
            {isSubmitting ? 'Starting request...' : 'Continue'} <ArrowRight size={16} />
          </button>
          <div className="text-center"><Link to="/" className="text-sm font-semibold text-[#002B5B] hover:text-[#1E4D8C]">Return to Login</Link></div>
        </form>
      </ResetShell>
    )
  }

  if (step === 1) {
    return (
      <ResetShell currentStep={1} title="Verify at the cabinet" description="The cabinet confirms that the registered NFC card belongs to this reset request.">
        <div className="space-y-5">
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-[#31577f]"><div className="mb-2 flex items-center gap-2 font-bold text-[#002B5B]"><KeyRound size={18} aria-hidden="true" /> Cabinet verification</div>Enter the recovery reference below on the Cabinet UI, then tap your registered NFC card. This page will automatically check for the cabinet’s verification.</div>
          <div className="rounded-xl border border-[#dbe3ed] bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#718096]">Recovery reference</p>
            <code className="mt-2 block break-all rounded-lg bg-[#F4F7FB] px-3 py-3 text-sm font-bold text-[#002B5B]" data-testid="recovery-reference">{requestId}</code>
            {requestExpiresAt && <p className="mt-2 text-xs text-[#718096]">Request expires: {requestExpiresAt}</p>}
          </div>
          <InlineFeedback type={success ? 'success' : 'error'}>{success || error}</InlineFeedback>
          <button type="button" onClick={() => void checkVerificationStatus()} disabled={isCheckingStatus || verificationEnded} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FFC107] px-5 py-3 text-sm font-bold text-[#002B5B] shadow-[0_8px_20px_rgba(255,193,7,0.28)] transition hover:bg-[#E0A800] focus:outline-none focus:ring-2 focus:ring-[#002B5B]/20 disabled:cursor-not-allowed disabled:opacity-70">{isCheckingStatus ? 'Checking status...' : 'Check verification status'} <ShieldCheck size={16} /></button>
          <button type="button" onClick={startOver} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#dbe3ed] bg-white px-5 py-2.5 text-sm font-semibold text-[#002B5B] transition hover:bg-[#EEF4FA]"><ArrowLeft size={16} /> Start over</button>
        </div>
      </ResetShell>
    )
  }

  return (
    <ResetShell currentStep={2} title="Create a new password" description="Choose a new password for your TapTrack account.">
      <form className="space-y-5" onSubmit={handlePasswordReset} noValidate>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm leading-5 text-emerald-800"><div className="mb-1 flex items-center gap-2 font-bold"><ShieldCheck size={18} aria-hidden="true" /> Reset authorization verified</div>Your cabinet verification was confirmed by TapTrack. Complete the form below before the authorization expires.</div>
        <PasswordField label="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required helper="Use at least 8 characters. TapTrack will also check common password rules." />
        <PasswordField label="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required autoComplete="new-password" />
        <InlineFeedback>{error}</InlineFeedback>
        <button type="submit" disabled={isSubmitting} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FFC107] px-5 py-3 text-sm font-bold text-[#002B5B] shadow-[0_8px_20px_rgba(255,193,7,0.28)] transition hover:bg-[#E0A800] focus:outline-none focus:ring-2 focus:ring-[#002B5B]/20 disabled:cursor-not-allowed disabled:opacity-70">{isSubmitting ? 'Changing password...' : 'Change password'} <LockKeyhole size={16} /></button>
        <button type="button" onClick={startOver} disabled={isSubmitting} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#dbe3ed] bg-white px-5 py-2.5 text-sm font-semibold text-[#002B5B] transition hover:bg-[#EEF4FA]"><ArrowLeft size={16} /> Start over</button>
      </form>
    </ResetShell>
  )
}
