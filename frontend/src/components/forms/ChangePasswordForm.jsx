import { useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../PageHeader.jsx'
import { FormSection, InlineFeedback, LoadingSpinner, PasswordField } from './FormPrimitives.jsx'

export default function ChangePasswordForm({ role }) {
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [feedback, setFeedback] = useState({ type: 'error', message: '' })
  const [loading, setLoading] = useState(false)

  const passwordScore = !newPassword ? 0 : [newPassword.length >= 8, /[A-Z]/.test(newPassword), /[a-z]/.test(newPassword), /\d/.test(newPassword), /[^A-Za-z0-9]/.test(newPassword)].filter(Boolean).length
  const dirty = Boolean(currentPassword || newPassword || confirmPassword)

  const goBack = () => {
    if (dirty && !window.confirm('Discard the password changes you entered?')) return
    navigate(`/${role}/profile`)
  }

  const update = (setter, field) => (event) => {
    setter(event.target.value)
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFeedback({ type: 'error', message: '' })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (loading) return
    const nextErrors = {}
    if (!currentPassword) nextErrors.current_password = 'Enter your current password.'
    if (!newPassword) nextErrors.new_password = 'Enter a new password.'
    else if (newPassword.length < 8) nextErrors.new_password = 'Use at least 8 characters.'
    if (!confirmPassword) nextErrors.confirm_password = 'Confirm your new password.'
    else if (newPassword !== confirmPassword) nextErrors.confirm_password = 'The passwords do not match.'
    if (Object.keys(nextErrors).length) return setErrors(nextErrors)

    setLoading(true)
    setErrors({})
    setFeedback({ type: 'error', message: '' })
    try {
      await api.post('/users/change_password/', { current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword })
      setFeedback({ type: 'success', message: 'Password changed successfully. You will be signed out for security.' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => {
        localStorage.removeItem('access')
        localStorage.removeItem('refresh')
        localStorage.removeItem('user')
        navigate(`/${role}/login`)
      }, 1500)
    } catch (error) {
      const data = error.response?.data || {}
      setErrors({ current_password: data.current_password, new_password: data.new_password, confirm_password: data.confirm_password })
      setFeedback({ type: 'error', message: data.detail || 'Password change failed. Review the fields and try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <PageHeader title="Change Password" description="Secure your account with a strong, unique password." />
        <button type="button" onClick={goBack} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-900">Back to profile</button>
      </div>
      <form onSubmit={handleSubmit} className="max-w-3xl space-y-4">
        <InlineFeedback type={feedback.type}>{feedback.message}</InlineFeedback>
        <FormSection icon={KeyRound} title="Verify your identity" description="Enter your current password before choosing a replacement.">
          <PasswordField label="Current password" required value={currentPassword} onChange={update(setCurrentPassword, 'current_password')} error={errors.current_password} autoComplete="current-password" />
        </FormSection>
        <FormSection icon={ShieldCheck} title="Choose a new password" description="A longer password with mixed character types is harder to guess.">
          <div className="space-y-5">
            <PasswordField label="New password" required value={newPassword} onChange={update(setNewPassword, 'new_password')} error={errors.new_password} helper="Use at least 8 characters with upper- and lowercase letters, a number, and a symbol." />
            {newPassword && <div aria-label={`Password strength ${passwordScore} out of 5`}><div className="flex gap-1">{[1, 2, 3, 4, 5].map((value) => <span key={value} className={`h-1.5 flex-1 rounded-full ${value <= passwordScore ? passwordScore < 3 ? 'bg-rose-500' : passwordScore < 5 ? 'bg-amber-500' : 'bg-emerald-500' : 'bg-slate-200'}`} />)}</div><p className="mt-1 text-xs text-slate-500">Strength: {passwordScore < 3 ? 'Weak' : passwordScore < 5 ? 'Good' : 'Strong'}</p></div>}
            <PasswordField label="Confirm new password" required value={confirmPassword} onChange={update(setConfirmPassword, 'confirm_password')} error={errors.confirm_password} />
          </div>
        </FormSection>
        <div className="flex flex-col-reverse gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">You will need to sign in again after this change.</p>
          <button type="submit" disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#F5B700] px-6 py-3 text-sm font-bold text-[#0B1F3A] hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:opacity-50">{loading ? <LoadingSpinner label="Saving…" /> : 'Change password'}</button>
        </div>
      </form>
    </div>
  )
}
