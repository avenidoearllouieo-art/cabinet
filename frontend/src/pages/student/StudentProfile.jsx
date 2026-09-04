import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Trash2, UploadCloud } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'

const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png']

export default function StudentProfile() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ email: '', contact_number: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [imageSaving, setImageSaving] = useState(false)
  const [error, setError] = useState('')
  const [toastMessage, setToastMessage] = useState('')
  const [selectedImage, setSelectedImage] = useState(null)
  const [previewSrc, setPreviewSrc] = useState(null)
  const [imageError, setImageError] = useState('')

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true)
      try {
        const response = await api.get('/users/profile/')
        setProfile(response.data)
        setForm({
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
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-700 shadow-sm">
        Loading profile...
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <PageHeader
          title="My Profile"
          description="Review and update your student profile details."
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

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <div className="rounded-[20px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6">
            <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
              <div className="rounded-[20px] border border-slate-200 p-5 text-center">
                <div className="relative mx-auto mb-5 h-28 w-28 overflow-hidden rounded-full bg-slate-100">
                  {profileImageUrl ? (
                    <img src={profileImageUrl} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-200 text-3xl font-semibold text-slate-700">
                      {profile?.first_name?.charAt(0)?.toUpperCase() || profile?.username?.charAt(0)?.toUpperCase() || 'S'}
                    </div>
                  )}
                </div>
                <div className="space-y-3 text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">Profile Picture</p>
                  <p>Upload JPG, JPEG, or PNG. Max 5 MB.</p>
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-[#F5B700] px-4 py-2 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus-within:ring-2 focus-within:ring-blue-900">
                    <Camera size={16} />
                    Choose Photo
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                  </label>
                  {selectedImage && <p className="break-all rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">{selectedImage.name} · {(selectedImage.size / (1024 * 1024)).toFixed(1)} MB</p>}
                  {selectedImage && (
                    <button type="button" onClick={handleUploadImage} disabled={imageSaving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-900 transition hover:bg-blue-100 disabled:opacity-60">
                      <UploadCloud size={16} />
                      {imageSaving ? 'Uploading...' : 'Upload Selected'}
                    </button>
                  )}
                  {profile?.profile_image_url && (
                    <button type="button" onClick={handleRemoveImage} disabled={imageSaving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60">
                      <Trash2 size={16} />
                      {imageSaving ? 'Removing...' : 'Remove Photo'}
                    </button>
                  )}
                </div>
                {imageError && <p className="mt-3 text-sm text-red-600">{imageError}</p>}
              </div>

              <div className="space-y-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Full Name</label>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">
                      {profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '—'}
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Student ID</label>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">
                      {profile?.student_id || '—'}
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Username</label>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">
                      {profile?.username || '—'}
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900">
                      {profile?.role === 'student' ? 'Student' : profile?.role || '—'}
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Email Address</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={handleInputChange('email')}
                      className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-900"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Contact Number</label>
                    <input
                      type="text"
                      value={form.contact_number}
                      onChange={handleInputChange('contact_number')}
                      className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-900"
                    />
                  </div>
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-6">
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-6">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Edit Profile</h3>
                    <p className="text-sm text-slate-500">Update your email address and contact number.</p>
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Email Address</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={handleInputChange('email')}
                      className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-900"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Contact Number</label>
                    <input
                      type="text"
                      value={form.contact_number}
                      onChange={handleInputChange('contact_number')}
                      className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-900"
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#F5B700] px-6 py-3 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:opacity-60"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <p className="text-sm text-slate-500">Your personal contact details stay private and are only used for account updates.</p>
                </div>
              </div>
            </form>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[20px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Account Summary</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span>Section</span>
                <span className="font-medium text-slate-900">{profile?.section_name || 'Not assigned'}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span>Academic Year</span>
                <span className="font-medium text-slate-900">{profile?.section_academic_year || '—'}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span>Year Level</span>
                <span className="font-medium text-slate-900">{profile?.section_year_level || '—'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-[20px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Security</h3>
            <p className="mt-3 text-sm text-slate-600">Keep your password updated regularly to protect your account.</p>
            <button
              type="button"
              onClick={() => navigate('/student/profile/change-password')}
              className="mt-4 inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Change Password
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
