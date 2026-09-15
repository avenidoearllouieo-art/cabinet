import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import NotificationDropdown from './NotificationDropdown'
import TapTrackLogo from './TapTrackLogo.jsx'

export default function Header() {
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef(null)
  const user = JSON.parse(localStorage.getItem('user') || '{}')

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
    <header className="fixed inset-x-0 top-0 z-50 h-[70px] border-b border-[#FFC107] bg-[#002B5B] px-6 text-white shadow-sm">
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

          <div ref={profileRef} className="relative hidden items-center gap-3 rounded-2xl border border-[#FFC107] bg-[#002B5B] px-3 py-2 shadow-sm sm:flex">
            <button type="button" onClick={handleProfileClick} className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FFC107] text-sm font-semibold text-[#002B5B]">
                {user.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-white">{user.username || 'User'}</p>
                <p className="text-xs text-white/75 capitalize">{user.role || 'user'}</p>
              </div>
              <ChevronDown size={16} className="text-[#FFC107]" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-full z-20 mt-3 w-48 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-lg">
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
