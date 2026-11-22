import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, BookOpen, Camera, Mail, Phone, Trash2, UploadCloud } from 'lucide-react'
import api from '../../services/api.js'
import Modal from '../../components/Modal.jsx'
import PageHeader from '../../components/PageHeader'
import { pluralize } from '../../utils/labels.js'
import ProfileSummaryCard from '../../components/profile/ProfileSummaryCard.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { FormActions, FormDialog, FormField, FormSection, FormStepper, InlineFeedback } from '../../components/forms/FormPrimitives.jsx'
import { controlClass } from '../../components/forms/formStyles.js'

const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png']
const emptyProfileForm = { first_name: '', last_name: '', instructor_id: '', username: '', email: '', contact_number: '' }
const formatAcademicYear = (value) => String(value || '').replace(/-(?=\d{4}$)/, '–')
const profileEditSteps = ['Profile details', 'Review changes']

const publishProfileUpdate = (nextProfile) => {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}')
  localStorage.setItem('user', JSON.stringify({ ...currentUser, ...nextProfile }))
  window.dispatchEvent(new CustomEvent('taptrack-profile-updated', { detail: nextProfile }))
}

export default function InstructorProfile() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState(emptyProfileForm)
  const [initialForm, setInitialForm] = useState(emptyProfileForm)
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [imageSaving, setImageSaving] = useState(false)
  const [editStep, setEditStep] = useState(0)
  const [validationErrors, setValidationErrors] = useState({})
  const [error, setError] = useState('')
  const [toastMessage, setToastMessage] = useState('')
  const [selectedImage, setSelectedImage] = useState(null)
  const [previewSrc, setPreviewSrc] = useState(null)
  const [imageError, setImageError] = useState('')
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const imageMutationInFlightRef = useRef(false)
  const saveInFlightRef = useRef(false)

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true)
      try {
        const response = await api.get('/users/profile/')
        setProfile(response.data)
        publishProfileUpdate(response.data)
        const nextForm = {
          first_name: response.data.first_name || '',
          last_name: response.data.last_name || '',
          instructor_id: response.data.instructor_id || '',
          username: response.data.username || '',
          email: response.data.email || '',
          contact_number: response.data.contact_number || '',
        }
        setForm(nextForm)
        setInitialForm(nextForm)
        setError('')
      } catch (err) {
        console.error('Unable to load profile', err)
        setError('Unable to load profile. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [])

  useEffect(() => {
    return () => {
      if (previewSrc) {
        URL.revokeObjectURL(previewSrc)
      }
    }
  }, [previewSrc])

  const profileImageUrl = useMemo(() => {
    if (previewSrc) return previewSrc
    if (profile?.profile_image_url) return profile.profile_image_url
    return null
  }, [previewSrc, profile])

  const handleInputChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
    setValidationErrors((current) => ({ ...current, [field]: '' }))
    setError('')
  }

  const handleImageSelect = (event) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!allowedImageTypes.includes(file.type)) {
      setImageError('Only JPG, JPEG, and PNG files are allowed.')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setImageError('Image must be 5 MB or smaller.')
      return
    }

    setImageError('')
    setSelectedImage(file)

    if (previewSrc) {
      URL.revokeObjectURL(previewSrc)
    }
    setPreviewSrc(URL.createObjectURL(file))
    setIsPreviewOpen(true)
  }

  const validateProfileDetails = () => {
    const trimmedForm = {
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      instructor_id: form.instructor_id.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      contact_number: form.contact_number.trim(),
    }

    const nextErrors = {}
    if (!trimmedForm.first_name) nextErrors.first_name = 'Enter your first name.'
    if (!trimmedForm.last_name) nextErrors.last_name = 'Enter your last name.'
    if (!trimmedForm.instructor_id) nextErrors.instructor_id = 'Enter your Employee ID.'
    if (!trimmedForm.username) nextErrors.username = 'Enter your username.'
    if (!trimmedForm.email) nextErrors.email = 'Enter your email address.'
    else if (!/^\S+@\S+\.\S+$/.test(trimmedForm.email)) nextErrors.email = 'Enter a valid email address.'
    setValidationErrors(nextErrors)
    if (Object.keys(nextErrors).length) setError('Correct the highlighted information to continue.')
    return Object.keys(nextErrors).length === 0
  }

  const handleContinue = () => {
    if (editStep === 0 && !validateProfileDetails()) return
    setError('')
    setEditStep((current) => Math.min(current + 1, profileEditSteps.length - 1))
  }

  const handleSaveProfile = async (event) => {
    event.preventDefault()
    if (editStep !== profileEditSteps.length - 1) {
      handleContinue()
      return
    }
    if (saveInFlightRef.current) return
    if (selectedImage) {
      setEditStep(0)
      setImageError('Upload or remove the selected profile picture before saving.')
      return
    }
    if (!validateProfileDetails()) {
      setEditStep(0)
      return
    }
    saveInFlightRef.current = true
    const trimmedForm = {
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      instructor_id: form.instructor_id.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      contact_number: form.contact_number.trim(),
    }

    setSaving(true)
    setError('')

    try {
      const response = await api.patch('/users/update_profile/', trimmedForm)
      const updatedProfile = { ...profile, ...response.data }
      setProfile(updatedProfile)
      publishProfileUpdate(response.data)
      const nextForm = {
        first_name: updatedProfile.first_name || '',
        last_name: updatedProfile.last_name || '',
        instructor_id: updatedProfile.instructor_id || '',
        username: updatedProfile.username || '',
        email: updatedProfile.email || '',
        contact_number: updatedProfile.contact_number || '',
      }
      setForm(nextForm)
      setInitialForm(nextForm)
      setValidationErrors({})
      setSelectedImage(null)
      if (previewSrc) {
        URL.revokeObjectURL(previewSrc)
        setPreviewSrc(null)
      }
      setEditStep(0)
      setIsEditing(false)
      setToastMessage('Profile details updated successfully.')
      window.setTimeout(() => setToastMessage(''), 4000)
    } catch (err) {
      console.error('Error updating profile', err)
      setError('Unable to update profile. Please check your input.')
      const data = err.response?.data || {}
      setValidationErrors(Object.fromEntries(
        ['first_name', 'last_name', 'instructor_id', 'username', 'email', 'contact_number']
          .filter((field) => data[field])
          .map((field) => [field, Array.isArray(data[field]) ? data[field].join(' ') : data[field]]),
      ))
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setForm(initialForm)
    setEditStep(0)
    setValidationErrors({})
    setSelectedImage(null)
    setImageError('')
    setIsPreviewOpen(false)
    if (previewSrc) {
      URL.revokeObjectURL(previewSrc)
      setPreviewSrc(null)
    }
    setIsEditing(false)
    setError('')
  }

  const handleUploadImage = async () => {
    if (!selectedImage) {
      setImageError('Please select a profile image first.')
      return
    }
    if (imageMutationInFlightRef.current) return

    imageMutationInFlightRef.current = true
    setImageSaving(true)
    setImageError('')

    try {
      const formData = new FormData()
      formData.append('profile_image', selectedImage)
      const response = await api.post('/users/upload_profile_image/', formData)
      setProfile((current) => ({ ...current, ...response.data }))
      publishProfileUpdate(response.data)
      setToastMessage('Profile image uploaded successfully.')
      setSelectedImage(null)
      if (previewSrc) {
        URL.revokeObjectURL(previewSrc)
        setPreviewSrc(null)
      }
      window.setTimeout(() => setToastMessage(''), 4000)
    } catch (err) {
      console.error('Error uploading profile image', err)
      setImageError('Unable to upload profile image.')
    } finally {
      imageMutationInFlightRef.current = false
      setImageSaving(false)
    }
  }

  const handleRemoveImage = async () => {
    if (imageMutationInFlightRef.current) return
    imageMutationInFlightRef.current = true
    setImageSaving(true)
    setImageError('')

    try {
      const response = await api.post('/users/remove_profile_image/')
      setProfile((current) => ({ ...current, ...response.data }))
      publishProfileUpdate(response.data)
      setSelectedImage(null)
      if (previewSrc) {
        URL.revokeObjectURL(previewSrc)
        setPreviewSrc(null)
      }
      setToastMessage('Profile image removed successfully.')
      window.setTimeout(() => setToastMessage(''), 4000)
    } catch (err) {
      console.error('Error removing profile image', err)
      setImageError('Unable to remove profile image.')
    } finally {
      imageMutationInFlightRef.current = false
      setImageSaving(false)
    }
  }

  const openEditProfile = () => {
    setError('')
    setImageError('')
    setValidationErrors({})
    setEditStep(0)
    setIsEditing(true)
  }

  const assignedSectionList = profile?.assigned_sections || []
  const profileDirty = Object.keys(form).some((field) => form[field] !== initialForm[field])
  const fullName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || profile?.username || 'Instructor'
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">Loading profile…</div>
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Profile"
        description="Manage your account and contact information."
        action={<button type="button" onClick={() => navigate(-1)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#0B2A4A] transition hover:bg-slate-50"><ArrowLeft size={16} />Back</button>}
      />

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {toastMessage && <div role="status" className="fixed bottom-6 right-6 z-50 rounded-xl bg-green-100 px-4 py-3 text-sm font-medium text-green-800 shadow-lg">{toastMessage}</div>}

      <ProfileSummaryCard
        imageUrl={profileImageUrl}
        fullName={fullName}
        initials={initials || 'I'}
        role={profile?.role === 'instructor' ? 'Instructor' : profile?.role || 'Not recorded'}
        identity={[
          { label: 'Username', value: profile?.username },
          { label: 'Employee ID', value: profile?.instructor_id },
        ]}
        facts={[
          { icon: Mail, label: 'Email Address', value: profile?.email },
          { icon: Phone, label: 'Contact Number', value: profile?.contact_number },
        ]}
        action={<button type="button" onClick={openEditProfile} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[#F5B700] px-5 py-2 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-[#0B2A4A]">Edit Profile</button>}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef4fa] text-[#0B2A4A]"><BookOpen size={18} /></div>
          <div>
            <h2 className="text-base font-semibold text-[#0B2A4A]">Assigned Sections</h2>
            <p className="text-sm text-slate-500">{pluralize(assignedSectionList.length, 'section')}</p>
          </div>
        </div>
        {assignedSectionList.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">No assigned sections yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {assignedSectionList.map((section) => (
              <article key={section.section_id || section.id || section.section_name} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-semibold text-slate-900">{section.section_name || 'Section not recorded'}</h3>
                {section.subject_code && <p className="mt-0.5 text-xs font-medium text-slate-500">{section.subject_code}</p>}
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-slate-500">Year level</dt><dd className="mt-1 font-medium text-slate-700">{section.year_level || 'Not recorded'}</dd></div>
                  {section.academic_year && <div className="col-span-2"><dt className="text-xs text-slate-500">Academic year</dt><dd className="mt-1 font-medium text-slate-700">{formatAcademicYear(section.academic_year)}</dd></div>}
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 className="text-base font-semibold text-[#0B2A4A]">Security</h2>
          <p className="mt-1 text-sm text-slate-500">Update your account password through the secure password flow.</p>
        </div>
        <button type="button" onClick={() => navigate('/instructor/profile/change-password')} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#0B2A4A] transition hover:border-[#F5B700] hover:bg-slate-50">Change Password</button>
      </section>

      <FormDialog
        isOpen={isEditing}
        title="Edit Profile"
        description="Update your account details and profile picture."
        onClose={handleCancelEdit}
        onSubmit={handleSaveProfile}
        dirty={profileDirty || Boolean(selectedImage)}
        busy={saving || imageSaving}
        stepper={<FormStepper steps={profileEditSteps} currentStep={editStep} />}
        actions={<FormActions onCancel={handleCancelEdit} onBack={editStep > 0 ? () => setEditStep(0) : undefined} onNext={handleContinue} isLastStep={editStep === profileEditSteps.length - 1} submitLabel="Save Changes" busy={saving || imageSaving} dirty={profileDirty || Boolean(selectedImage)} />}
      >
        <div className="space-y-4">
          <InlineFeedback>{error}</InlineFeedback>
          {editStep === 0 ? (
            <>
              <FormSection icon={BadgeCheck} title="Account & contact" description="Keep your instructor identity and contact details up to date.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="First name" required error={validationErrors.first_name}>{({ id, describedBy, invalid }) => <input id={id} value={form.first_name} onChange={handleInputChange('first_name')} className={controlClass(invalid)} autoComplete="given-name" aria-describedby={describedBy} aria-invalid={invalid} />}</FormField>
                  <FormField label="Last name" required error={validationErrors.last_name}>{({ id, describedBy, invalid }) => <input id={id} value={form.last_name} onChange={handleInputChange('last_name')} className={controlClass(invalid)} autoComplete="family-name" aria-describedby={describedBy} aria-invalid={invalid} />}</FormField>
                  <FormField label="Employee ID" required error={validationErrors.instructor_id}>{({ id, describedBy, invalid }) => <input id={id} value={form.instructor_id} onChange={handleInputChange('instructor_id')} className={controlClass(invalid)} aria-describedby={describedBy} aria-invalid={invalid} />}</FormField>
                  <FormField label="Username" required error={validationErrors.username}>{({ id, describedBy, invalid }) => <input id={id} value={form.username} onChange={handleInputChange('username')} className={controlClass(invalid)} autoComplete="username" aria-describedby={describedBy} aria-invalid={invalid} />}</FormField>
                  <FormField label="Email Address" required error={validationErrors.email}>{({ id, describedBy, invalid }) => <input id={id} type="email" value={form.email} onChange={handleInputChange('email')} className={controlClass(invalid)} autoComplete="email" aria-describedby={describedBy} aria-invalid={invalid} />}</FormField>
                  <FormField label="Contact Number" optional error={validationErrors.contact_number}>{({ id, describedBy, invalid }) => <input id={id} type="tel" value={form.contact_number} onChange={handleInputChange('contact_number')} className={controlClass(invalid)} autoComplete="tel" aria-describedby={describedBy} aria-invalid={invalid} />}</FormField>
                </div>
              </FormSection>

              <FormSection icon={Camera} title="Profile picture" description="JPG, JPEG, or PNG. Maximum file size 5 MB.">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <UserAvatar imageUrl={profileImageUrl} initials={initials || 'I'} alt={`${fullName} profile picture`} size="xl" className="shrink-0 border border-slate-200 bg-[#eaf0f6] text-[#0B2A4A]" />
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#F5B700] px-4 py-2 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400">
                      <Camera size={16} />Choose Photo
                      <input type="file" accept="image/jpeg,image/jpg,image/png" className="sr-only" onChange={handleImageSelect} />
                    </label>
                    <button type="button" onClick={handleUploadImage} disabled={imageSaving || !selectedImage} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#0B2A4A] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><UploadCloud size={16} />{imageSaving ? 'Uploading…' : 'Upload'}</button>
                    {(profile?.profile_image_url || profile?.profile_image) && <button type="button" onClick={handleRemoveImage} disabled={imageSaving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={16} />Remove</button>}
                    <button type="button" onClick={() => setIsPreviewOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#0B2A4A] hover:bg-slate-50"><Camera size={16} />Preview</button>
                  </div>
                </div>
                {selectedImage && <p className="mt-3 break-all text-xs text-slate-500">Selected: {selectedImage.name} · {(selectedImage.size / (1024 * 1024)).toFixed(1)} MB</p>}
                {imageError && <InlineFeedback className="mt-3">{imageError}</InlineFeedback>}
              </FormSection>
            </>
          ) : (
            <FormSection icon={BadgeCheck} title="Review profile changes" description="Confirm your account details and uploaded profile picture before saving.">
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <UserAvatar imageUrl={profileImageUrl} initials={initials || 'I'} alt={`${fullName} profile picture`} size="xl" className="shrink-0 border border-slate-200 bg-[#eaf0f6] text-[#0B2A4A]" />
                {selectedImage && <p className="text-sm text-amber-800">The selected picture has not been uploaded yet.</p>}
              </div>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <ProfileReviewItem label="Name" value={`${form.first_name} ${form.last_name}`.trim()} />
                <ProfileReviewItem label="Employee ID" value={form.instructor_id} />
                <ProfileReviewItem label="Username" value={form.username} />
                <ProfileReviewItem label="Email Address" value={form.email} />
                <ProfileReviewItem label="Contact Number" value={form.contact_number} />
              </dl>
            </FormSection>
          )}
        </div>
      </FormDialog>

      <Modal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title="Profile Picture Preview">
        <div className="flex flex-col items-center gap-4">
          <div className="h-[280px] w-full overflow-hidden rounded-xl bg-slate-100">
            {previewSrc ? <UserAvatar imageUrl={previewSrc} initials={initials || 'I'} alt="Profile preview" size="md" shape="square" className="h-full w-full rounded-md bg-slate-100" /> : <div className="flex h-full w-full items-center justify-center text-xl text-slate-500">No image selected</div>}
          </div>
          <button type="button" onClick={() => setIsPreviewOpen(false)} className="min-h-11 rounded-lg bg-[#0B2A4A] px-5 py-2 text-sm font-semibold text-white hover:bg-[#153c63]">Close Preview</button>
        </div>
      </Modal>
    </div>
  )
}

function ProfileReviewItem({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-800">{value || 'Not recorded'}</dd>
    </div>
  )
}

