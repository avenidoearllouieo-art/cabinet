import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, BookOpen, Camera, Mail, Phone, Trash2, UploadCloud } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal.jsx'
import ProfileSummaryCard from '../../components/profile/ProfileSummaryCard.jsx'
import { FormActions, FormDialog, FormField, FormSection, InlineFeedback } from '../../components/forms/FormPrimitives.jsx'
import { controlClass } from '../../components/forms/formStyles.js'

const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png']

const publishProfileUpdate = (nextProfile) => {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}')
  localStorage.setItem('user', JSON.stringify({ ...currentUser, ...nextProfile }))
  window.dispatchEvent(new CustomEvent('taptrack-profile-updated', { detail: nextProfile }))
}

export default function StudentProfile() {
  const navigate = useNavigate()
  const location = useLocation()
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ email: '', contact_number: '' })
  const [initialForm, setInitialForm] = useState({ email: '', contact_number: '' })
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [imageSaving, setImageSaving] = useState(false)
  const [error, setError] = useState('')
  const [toastMessage, setToastMessage] = useState('')
  const [selectedImage, setSelectedImage] = useState(null)
  const [previewSrc, setPreviewSrc] = useState(null)
  const [imageError, setImageError] = useState('')
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const instructorCardRef = useRef(null)

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true)
      try {
        const response = await api.get('/users/profile/')
        setProfile(response.data)
        publishProfileUpdate(response.data)
        const nextForm = {
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

  useEffect(() => {
    if (location.hash !== '#my-instructor' || !profile) return undefined
    const timeoutId = window.setTimeout(() => instructorCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
    return () => window.clearTimeout(timeoutId)
  }, [location.hash, profile])

  const profileImageUrl = useMemo(() => {
    if (previewSrc) return previewSrc
    if (profile?.profile_image_url) return profile.profile_image_url
    return null
  }, [previewSrc, profile])

  const handleInputChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
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

  const handleSaveProfile = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      const response = await api.patch('/users/update_profile/', {
        email: form.email,
        contact_number: form.contact_number,
      })
      setProfile(response.data)
      publishProfileUpdate(response.data)
      const nextForm = {
        email: response.data.email || '',
        contact_number: response.data.contact_number || '',
      }
      setForm(nextForm)
      setInitialForm(nextForm)
      setIsEditing(false)
      setToastMessage('Profile details updated successfully.')
      localStorage.setItem('user', JSON.stringify({ ...JSON.parse(localStorage.getItem('user') || '{}'), email: response.data.email }))
      window.setTimeout(() => setToastMessage(''), 4000)
    } catch (err) {
      console.error('Error updating profile', err)
      setError('Unable to update profile. Please check your input.')
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setForm(initialForm)
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

    setImageSaving(true)
    setImageError('')

    try {
      const formData = new FormData()
      formData.append('profile_image', selectedImage)
      const response = await api.post('/users/upload_profile_image/', formData)
      setProfile(response.data)
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
      setImageSaving(false)
    }
  }

  const handleRemoveImage = async () => {
    setImageSaving(true)
    setImageError('')

    try {
      const response = await api.post('/users/remove_profile_image/')
      setProfile(response.data)
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
      setImageSaving(false)
    }
  }

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">Loading profile…</div>
  }

  const fullName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || profile?.username || 'Student'
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')
  const instructors = profile?.section_instructors || []
  const profileDirty = form.email !== initialForm.email || form.contact_number !== initialForm.contact_number

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Profile"
        description="Manage your student account and academic information."
        action={<button type="button" onClick={() => navigate(-1)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#0B2A4A] transition hover:bg-slate-50"><ArrowLeft size={16} />Back</button>}
      />

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {toastMessage && <div role="status" className="fixed bottom-6 right-6 z-50 rounded-xl bg-green-100 px-4 py-3 text-sm font-medium text-green-800 shadow-lg">{toastMessage}</div>}

      <ProfileSummaryCard
        imageUrl={profileImageUrl}
        fullName={fullName}
        initials={initials || 'S'}
        role={profile?.role === 'student' ? 'Student' : profile?.role || 'Not recorded'}
        identity={[
          { label: 'Student ID', value: profile?.student_id },
          { label: 'Username', value: profile?.username },
        ]}
        facts={[
          { icon: Mail, label: 'Email Address', value: profile?.email },
          { icon: Phone, label: 'Contact Number', value: profile?.contact_number },
        ]}
        action={<button type="button" onClick={() => { setError(''); setImageError(''); setIsEditing(true) }} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[#F5B700] px-5 py-2 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-[#0B2A4A]">Edit Profile</button>}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef4fa] text-[#0B2A4A]"><BookOpen size={18} /></div>
          <div>
            <h2 className="text-base font-semibold text-[#0B2A4A]">Academic Information</h2>
            <p className="text-sm text-slate-500">Current enrollment details</p>
          </div>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ProfileFact label="Section" value={profile?.section_name} />
          <ProfileFact label="Program" value={profile?.section_program} />
          <ProfileFact label="Year Level" value={profile?.section_year_level} />
          <ProfileFact label="Academic Year" value={profile?.section_academic_year} />
        </dl>
      </section>

      <section id="my-instructor" ref={instructorCardRef} className="scroll-mt-24 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef4fa] text-[#0B2A4A]"><BadgeCheck size={18} /></div>
          <div>
            <h2 className="text-base font-semibold text-[#0B2A4A]">My Instructor</h2>
            <p className="text-sm text-slate-500">Faculty assigned to {profile?.section_name || 'your section'}</p>
          </div>
        </div>
        {instructors.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {instructors.map((instructor) => (
              <InstructorContactCard key={instructor.id} instructor={instructor} sectionName={profile?.section_name} />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">No instructor is assigned to your section yet.</p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 className="text-base font-semibold text-[#0B2A4A]">Security</h2>
          <p className="mt-1 text-sm text-slate-500">Update your account password through the secure password flow.</p>
        </div>
        <button type="button" onClick={() => navigate('/student/profile/change-password')} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#0B2A4A] transition hover:border-[#F5B700] hover:bg-slate-50">Change Password</button>
      </section>

      <FormDialog
        isOpen={isEditing}
        title="Edit Profile"
        description="Update your contact details and profile picture."
        onClose={handleCancelEdit}
        onSubmit={handleSaveProfile}
        dirty={profileDirty || Boolean(selectedImage)}
        busy={saving}
        actions={<FormActions onCancel={handleCancelEdit} submitLabel="Save Changes" busy={saving} dirty={profileDirty || Boolean(selectedImage)} />}
      >
        <div className="space-y-4">
          <InlineFeedback>{error}</InlineFeedback>
          <FormSection icon={BadgeCheck} title="Contact information" description="Keep the contact details on your account current.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Email Address" required>{({ id, invalid }) => <input id={id} type="email" value={form.email} onChange={handleInputChange('email')} className={controlClass(invalid)} autoComplete="email" />}</FormField>
              <FormField label="Contact Number" optional>{({ id, invalid }) => <input id={id} type="tel" value={form.contact_number} onChange={handleInputChange('contact_number')} className={controlClass(invalid)} autoComplete="tel" />}</FormField>
            </div>
          </FormSection>
          <FormSection icon={Camera} title="Profile picture" description="JPG, JPEG, or PNG. Maximum file size 5 MB.">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                {profileImageUrl ? <img src={profileImageUrl} alt={`${fullName} profile preview`} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-[#eaf0f6] text-2xl font-bold text-[#0B2A4A]">{initials || 'S'}</div>}
              </div>
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
        </div>
      </FormDialog>

      <Modal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title="Profile Picture Preview">
        <div className="flex flex-col items-center gap-4">
          <div className="h-[280px] w-full overflow-hidden rounded-xl bg-slate-100">
            {profileImageUrl ? <img src={profileImageUrl} alt="Profile preview" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xl text-slate-500">No image selected</div>}
          </div>
          <button type="button" onClick={() => setIsPreviewOpen(false)} className="min-h-11 rounded-lg bg-[#0B2A4A] px-5 py-2 text-sm font-semibold text-white hover:bg-[#153c63]">Close Preview</button>
        </div>
      </Modal>
    </div>
  )
}

function ProfileFact({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-800">{value || 'Not recorded'}</dd>
    </div>
  )
}

function InstructorContactCard({ instructor, sectionName }) {
  const fullName = instructor.full_name || `${instructor.first_name || ''} ${instructor.last_name || ''}`.trim() || instructor.username || 'Instructor'
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-white">
        {instructor.profile_image_url ? <img src={instructor.profile_image_url} alt={`${fullName} profile`} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-[#eaf0f6] text-lg font-bold text-[#0B2A4A]">{initials || 'I'}</div>}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="break-words font-semibold text-[#0B2A4A]">{fullName}</h3>
        <span className="mt-1 inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">{instructor.role === 'instructor' ? 'Instructor / Faculty' : instructor.role || 'Faculty'}</span>
        <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <ProfileFact label="Email Address" value={instructor.email} />
          <ProfileFact label="Contact Number" value={instructor.contact_number} />
          <div className="sm:col-span-2"><ProfileFact label="Assigned Section" value={sectionName} /></div>
        </dl>
        {instructor.email ? (
          <a href={`mailto:${instructor.email}`} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg bg-[#F5B700] px-4 py-2 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400">Contact Instructor</a>
        ) : (
          <button type="button" disabled className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500">Contact Instructor</button>
        )}
      </div>
    </article>
  )
}
