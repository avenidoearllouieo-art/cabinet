import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Trash2, UploadCloud } from 'lucide-react'
import api from '../../services/api.js'
import Modal from '../../components/Modal.jsx'
import PageHeader from '../../components/PageHeader'

const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png']

const publishProfileUpdate = (nextProfile) => {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}')
  localStorage.setItem('user', JSON.stringify({ ...currentUser, ...nextProfile }))
  window.dispatchEvent(new CustomEvent('taptrack-profile-updated', { detail: nextProfile }))
}

export default function InstructorProfile() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ first_name: '', last_name: '', instructor_id: '', username: '', email: '', contact_number: '' })
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

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true)
      try {
        const response = await api.get('/users/profile/')
        setProfile(response.data)
        publishProfileUpdate(response.data)
        setForm({
          first_name: response.data.first_name || '',
          last_name: response.data.last_name || '',
          instructor_id: response.data.instructor_id || '',
          username: response.data.username || '',
          email: response.data.email || '',
          contact_number: response.data.contact_number || '',
        })
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
    const trimmedForm = {
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      instructor_id: form.instructor_id.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      contact_number: form.contact_number.trim(),
    }

    if (!trimmedForm.first_name || !trimmedForm.last_name || !trimmedForm.instructor_id || !trimmedForm.username || !trimmedForm.email) {
      setError('Full name, Employee ID, username, and email are required.')
      return
    }

    setSaving(true)
    setError('')

    try {
      const response = await api.patch('/users/update_profile/', trimmedForm)
      setProfile(response.data)
      publishProfileUpdate(response.data)
      setForm({
        first_name: response.data.first_name || '',
        last_name: response.data.last_name || '',
        instructor_id: response.data.instructor_id || '',
        username: response.data.username || '',
        email: response.data.email || '',
        contact_number: response.data.contact_number || '',
      })
      setIsEditing(false)
      setToastMessage('Profile details updated successfully.')
      window.setTimeout(() => setToastMessage(''), 4000)
    } catch (err) {
      console.error('Error updating profile', err)
      setError('Unable to update profile. Please check your input.')
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setForm({
      first_name: profile?.first_name || '',
      last_name: profile?.last_name || '',
      instructor_id: profile?.instructor_id || '',
      username: profile?.username || '',
      email: profile?.email || '',
      contact_number: profile?.contact_number || '',
    })
    setSelectedImage(null)
    setImageError('')
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

  const assignedSectionList = profile?.assigned_sections || []

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-700 shadow-sm">
        Loading profile...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <PageHeader
          title="My Profile"
          description="Review and update your instructor profile details."
        />
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft size={16} />
          Back
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {toastMessage && (
        <div role="status" className="fixed bottom-6 right-6 z-50 rounded-xl bg-green-100 px-4 py-3 text-sm font-medium text-green-800 shadow-lg">
          {toastMessage}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="rounded-[20px] border border-[#E5E7EB] bg-white p-5 shadow-sm sm:p-6">
          <form onSubmit={handleSaveProfile} className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Profile Information</h2>
                <p className="text-sm text-slate-500">Manage your instructor credentials and profile picture.</p>
              </div>
              {!isEditing && (
                <button type="button" onClick={() => setIsEditing(true)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#F5B700] px-5 py-2 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900">
                  Edit Profile
                </button>
              )}
            </div>
            <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
              <div className="rounded-[20px] border border-slate-200 p-4 text-center sm:p-5">
                <div className="relative mx-auto mb-5 h-28 w-28 overflow-hidden rounded-full bg-slate-100">
                  {profileImageUrl ? (
                    <img src={profileImageUrl} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-200 text-3xl font-semibold text-slate-700">
                      {profile?.first_name?.charAt(0)?.toUpperCase() || profile?.username?.charAt(0)?.toUpperCase() || 'I'}
                    </div>
                  )}
                </div>
                <div className="space-y-3 text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">Profile Picture</p>
                  <p>Upload JPG, JPEG, or PNG. Max 5 MB.</p>
                  {isEditing && (
                    <>
                      <label className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#F5B700] px-4 py-2 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus-within:ring-2 focus-within:ring-blue-900">
                        <Camera size={16} />
                        Choose Photo
                        <input type="file" accept="image/jpeg,image/jpg,image/png" className="hidden" onChange={handleImageSelect} />
                      </label>
                      {selectedImage && <p className="break-all rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">{selectedImage.name} · {(selectedImage.size / (1024 * 1024)).toFixed(1)} MB</p>}
                      <button type="button" onClick={handleUploadImage} disabled={imageSaving || !selectedImage} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-900 transition hover:bg-blue-100 disabled:opacity-60">
                        <UploadCloud size={16} />
                        {imageSaving ? 'Uploading...' : 'Upload'}
                      </button>
                      {(profile?.profile_image_url || profile?.profile_image) && (
                        <button type="button" onClick={handleRemoveImage} disabled={imageSaving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60">
                          <Trash2 size={16} />
                          {imageSaving ? 'Removing...' : 'Remove'}
                        </button>
                      )}
                    </>
                  )}
                  <button type="button" onClick={() => setIsPreviewOpen(true)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-900">
                    <Camera size={16} />
                    Preview
                  </button>
                </div>
                {imageError && <p className="mt-3 text-sm text-red-600">{imageError}</p>}
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Full Name</label>
                    {isEditing ? <input value={`${form.first_name} ${form.last_name}`.trim()} onChange={(event) => { const [firstName = '', ...lastNames] = event.target.value.split(' '); setForm((prev) => ({ ...prev, first_name: firstName, last_name: lastNames.join(' ') })) }} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-900" /> : <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">{profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '—'}</div>}
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Employee ID</label>
                    {isEditing ? <input value={form.instructor_id} onChange={handleInputChange('instructor_id')} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-900" /> : <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">{profile?.instructor_id || '—'}</div>}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Username</label>
                    {isEditing ? <input value={form.username} onChange={handleInputChange('username')} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-900" /> : <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">{profile?.username || '—'}</div>}
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">
                      {profile?.role === 'instructor' ? 'Instructor' : profile?.role || '—'}
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Email Address</label>
                    {isEditing ? <input type="email" value={form.email} onChange={handleInputChange('email')} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-900" /> : <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">{profile?.email || '—'}</div>}
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Contact Number</label>
                    {isEditing ? <input value={form.contact_number} onChange={handleInputChange('contact_number')} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-900" /> : <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">{profile?.contact_number || '—'}</div>}
                  </div>
                </div>
              </div>
            </div>
            {isEditing && <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={handleCancelEdit} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button><button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-[#F5B700] px-5 py-2 text-sm font-bold text-[#0B1F3A] hover:bg-amber-400 disabled:opacity-60">{saving ? 'Saving...' : 'Save Changes'}</button></div>}
          </form>
        </div>

        <div className="space-y-6">
          <div className="rounded-[20px] border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900">About</h3>
            <div className="mt-5 space-y-4 text-sm text-slate-700">
              <div>
                <p className="text-slate-500">Name</p>
                <p className="mt-1 text-slate-900">{profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Username</p>
                <p className="mt-1 text-slate-900">{profile?.username || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Employee ID</p>
                <p className="mt-1 text-slate-900">{profile?.instructor_id || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Role</p>
                <p className="mt-1 text-slate-900">{profile?.role === 'instructor' ? 'Instructor' : profile?.role || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Contact Number</p>
                <p className="mt-1 text-slate-900">{profile?.contact_number || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Email</p>
                <p className="mt-1 text-slate-900">{profile?.email || '—'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[20px] border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900">Assigned Sections</h3>
            {assignedSectionList.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No assigned sections yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {assignedSectionList.map((section) => (
                  <div key={section.section_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">{section.section_name}</p>
                    <p>{section.academic_year} · {section.year_level}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[20px] border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900">Security</h3>
            <p className="mt-3 text-sm text-slate-600">Update your password using the secure account password flow.</p>
            <button type="button" onClick={() => navigate('/instructor/profile/change-password')} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-900">
              Change Password
            </button>
          </div>
        </div>
      </div>

      <Modal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title="Profile Picture Preview">
        <div className="flex flex-col items-center gap-4">
          <div className="h-[280px] w-full overflow-hidden rounded-[20px] bg-slate-100">
            {profileImageUrl ? (
              <img src={profileImageUrl} alt="Preview" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xl text-slate-500">No image selected</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsPreviewOpen(false)}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Close Preview
          </button>
        </div>
      </Modal>
    </div>
  )
}
