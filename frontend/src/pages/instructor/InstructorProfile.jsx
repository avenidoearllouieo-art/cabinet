import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Trash2, UploadCloud } from 'lucide-react'
import api from '../../services/api.js'
import Modal from '../../components/Modal.jsx'
import PageHeader from '../../components/PageHeader'

const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png']

export default function InstructorProfile() {
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
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

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

  const assignedSectionList = profile?.assigned_sections || []

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
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl bg-green-100 px-4 py-3 text-sm font-medium text-green-800 shadow-lg">
          {toastMessage}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="rounded-[20px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6">
            <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
              <div className="rounded-[20px] border border-slate-200 p-5 text-center">
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
                </div>
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
                    <label className="mb-2 block text-sm font-medium text-slate-700">Employee ID</label>
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
                      {profile?.role === 'instructor' ? 'Instructor' : profile?.role || '—'}
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
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-slate-400"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Contact Number</label>
                    <input
                      type="text"
                      value={form.contact_number}
                      onChange={handleInputChange('contact_number')}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Assigned Sections</label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-900">
                    {assignedSectionList.length === 0 ? (
                      <p className="text-sm text-slate-500">No sections assigned.</p>
                    ) : (
                      <div className="space-y-3">
                        {assignedSectionList.map((section) => (
                          <div key={section.section_id} className="rounded-2xl border border-slate-200 bg-white p-3">
                            <p className="font-semibold text-slate-900">{section.section_name}</p>
                            <p className="text-sm text-slate-500">{section.academic_year + ' · ' + section.year_level}</p>
                          </div>
                        ))}
                      </div>
                    )}
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
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-slate-400"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Contact Number</label>
                    <input
                      type="text"
                      value={form.contact_number}
                      onChange={handleInputChange('contact_number')}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-slate-400"
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center justify-center rounded-2xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/instructor/profile/change-password')}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Change Password
                  </button>
                </div>
              </div>
            </form>

            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-6">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-900">Profile Picture</h3>
                <p className="text-sm text-slate-500">Upload or remove your current instructor photo.</p>
              </div>

              <div className="grid gap-5 sm:grid-cols-[1fr_220px]">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Select Image</label>
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png"
                      onChange={handleImageSelect}
                      className="w-full text-sm text-slate-700"
                    />
                  </div>

                  {imageError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {imageError}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleUploadImage}
                      disabled={imageSaving || !selectedImage}
                      className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                    >
                      <UploadCloud size={16} />
                      Upload
                    </button>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      disabled={imageSaving || !profile?.profile_image}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      <Trash2 size={16} />
                      Remove
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
                  <div className="mx-auto mb-4 h-32 w-32 overflow-hidden rounded-full bg-slate-100">
                    {profileImageUrl ? (
                      <img src={profileImageUrl} alt="Preview" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-slate-200 text-4xl font-semibold text-slate-700">
                        {profile?.first_name?.charAt(0)?.toUpperCase() || profile?.username?.charAt(0)?.toUpperCase() || 'I'}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPreviewOpen(true)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    <Camera size={16} />
                    Preview
                  </button>
                </div>
              </div>
            </div>
          </div>
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
                <p className="mt-1 text-slate-900">{profile?.student_id || '—'}</p>
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
