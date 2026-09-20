import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import NotificationDropdown from './NotificationDropdown'
import TapTrackLogo from './TapTrackLogo.jsx'
import api from '../services/api.js'

export default function Header() {
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef(null)
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || '{}'))

  useEffect(() => {
    const applyProfile = (profile) => {
      if (!profile) return
      setUser((current) => {
        const nextUser = { ...current, ...profile }
        localStorage.setItem('user', JSON.stringify(nextUser))
        return nextUser
      })
    }

    const handleProfileUpdated = (event) => applyProfile(event.detail)
    const handleStorageChange = (event) => {
      if (event.key !== 'user') return
      try {
        setUser(JSON.parse(event.newValue || '{}'))
      } catch {
        setUser({})
      }
    }

    window.addEventListener('taptrack-profile-updated', handleProfileUpdated)
    window.addEventListener('storage', handleStorageChange)

    if (user.role === 'instructor' || user.role === 'student') {
      api.get('/users/profile/')
        .then((response) => applyProfile(response.data))
        .catch(() => {})
    }

    return () => {
      window.removeEventListener('taptrack-profile-updated', handleProfileUpdated)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [user.role])

  const handleLogout = () => {
    localStorage.removeItem('access')
    localStorage.removeItem('refresh')
    localStorage.removeItem('user')
    navigate('/')
  }

  const handleProfileClick = () => {
    setProfileOpen((prev) => !prev)
  }

  useEffect(() => {
    function handleClickOutside(event) {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const getHeaderText = () => {
    if (user.role === 'instructor') {
      return {
        title: 'TapTrack Instructor',
        subtitle: 'Manage activities and student submissions'
      }
    }
    if (user.role === 'student') {
      return {
        title: 'TapTrack Student',
        subtitle: 'Track your activities, submissions, and cabinet access'
      }
    }
    return {
      title: 'TapTrack Admin',
      subtitle: 'Cabinet activity and user management'
    }
  }

  const headerText = getHeaderText()

  return (
    <header className="app-header fixed inset-x-0 top-0 z-50 h-[70px] border-b border-white/10 bg-[#002B5B] px-5 text-white shadow-[0_4px_18px_rgba(0,43,91,0.12)] sm:px-6">
      <div className="flex h-full items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <TapTrackLogo responsive />
          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-white">{headerText.title}</p>
            <p className="text-xs text-white/75">{headerText.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {(user.role === 'instructor' || user.role === 'student') && <NotificationDropdown />}

          <div ref={profileRef} className="relative hidden items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2 sm:flex">
            <button type="button" onClick={handleProfileClick} className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#FFC107] text-sm font-semibold text-[#002B5B]">
                {user.profile_image_url ? <img src={user.profile_image_url} alt="Profile" className="h-full w-full object-cover" /> : (user.username?.charAt(0).toUpperCase() || 'U')}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-white">{user.username || 'User'}</p>
                <p className="text-xs text-white/75 capitalize">{user.role || 'user'}</p>
              </div>
              <ChevronDown size={16} className="text-[#FFC107]" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-full z-20 mt-3 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_18px_40px_rgba(0,43,91,0.16)]">
                {user.role === 'instructor' && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setProfileOpen(false); navigate('/instructor/profile') }}
                      className="w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      My Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => { setProfileOpen(false); navigate('/instructor/profile/change-password') }}
                      className="w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Change Password
                    </button>
                  </>
                )}
                {user.role === 'student' && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setProfileOpen(false); navigate('/student/profile') }}
                      className="w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      My Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => { setProfileOpen(false); navigate('/student/profile/change-password') }}
                      className="w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Change Password
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => { setProfileOpen(false); handleLogout() }}
                  className="w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  Logout
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </header>
  )
}
