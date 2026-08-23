import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import api from '../services/api.js'
import NotificationDropdown from './NotificationDropdown'

export default function Header() {
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)
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

  useEffect(() => {
    if (user.role === 'instructor') {
      fetchUnreadNotifications()
    }
  }, [user.role])

  const fetchUnreadNotifications = async () => {
    try {
      const response = await api.get('/notifications/unread_count/')
      setUnreadCount(response.data.unread_count || 0)
    } catch (error) {
      console.error('Failed to fetch notification count:', error)
    }
  }

  const handleNotificationClick = () => {
    if (user.role === 'instructor') {
      navigate('/instructor/notifications')
    }
  }

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
    <header className="fixed inset-x-0 top-0 z-50 h-[70px] border-b border-[#E5E7EB] bg-white px-6 shadow-sm">
      <div className="flex h-full items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#2563EB] text-lg font-semibold text-white">
            TT
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-[#111827]">{headerText.title}</p>
            <p className="text-xs text-[#6B7280]">{headerText.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {(user.role === 'instructor' || user.role === 'student') && <NotificationDropdown />}

          <div ref={profileRef} className="relative hidden items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm sm:flex">
            <button type="button" onClick={handleProfileClick} className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2563EB] text-sm font-semibold text-white">
                {user.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-[#111827]">{user.username || 'User'}</p>
                <p className="text-xs text-[#6B7280] capitalize">{user.role || 'user'}</p>
              </div>
              <ChevronDown size={16} className="text-[#6B7280]" />
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
