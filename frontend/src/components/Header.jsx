import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Menu, X } from 'lucide-react'
import NotificationDropdown from './NotificationDropdown'
import TapTrackLogo from './TapTrackLogo.jsx'
import UserAvatar from './UserAvatar.jsx'
import api from '../services/api.js'

const headerProfileFields = ['id', 'username', 'email', 'role', 'first_name', 'last_name', 'profile_image_url', 'updated_at']

function getHeaderProfile(profile) {
  return Object.fromEntries(headerProfileFields
    .filter((field) => Object.hasOwn(profile || {}, field))
    .map((field) => [field, profile[field]]))
}

function getStoredHeaderUser() {
  try {
    return getHeaderProfile(JSON.parse(localStorage.getItem('user') || '{}'))
  } catch {
    return {}
  }
}

export default function Header({ sidebarCollapsed = false, mobileNavOpen = false, onMenuToggle }) {
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef(null)
  const profileButtonRef = useRef(null)
  const profileUpdateVersionRef = useRef(0)
  const [user, setUser] = useState(getStoredHeaderUser)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 600)
  const menuLabel = isMobile
    ? mobileNavOpen ? 'Close navigation' : 'Open navigation'
    : sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 600)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const applyProfile = (profile) => {
      if (!profile) return
      const safeProfile = getHeaderProfile(profile)
      profileUpdateVersionRef.current += 1
      setUser((current) => {
        const nextUser = { ...current, ...safeProfile }
        localStorage.setItem('user', JSON.stringify(nextUser))
        return nextUser
      })
    }

    const handleProfileUpdated = (event) => applyProfile(event.detail)
    const handleStorageChange = (event) => {
      if (event.key !== 'user') return
      try {
        profileUpdateVersionRef.current += 1
        setUser(getHeaderProfile(JSON.parse(event.newValue || '{}')))
      } catch {
        setUser({})
      }
    }

    window.addEventListener('taptrack-profile-updated', handleProfileUpdated)
    window.addEventListener('storage', handleStorageChange)

    if (user.role) {
      const requestVersion = profileUpdateVersionRef.current
      api.get('/users/profile/')
        .then((response) => {
          if (profileUpdateVersionRef.current === requestVersion) applyProfile(response.data)
        })
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

  useEffect(() => {
    if (!profileOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setProfileOpen(false)
        profileButtonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [profileOpen])

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
    <header className="app-header fixed inset-x-0 top-0 z-50 h-[70px] px-4 text-white sm:px-6">
      <div className="flex h-full items-center justify-between gap-2 sm:gap-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={onMenuToggle}
            aria-label={menuLabel}
            aria-controls={`${user.role || 'admin'}-sidebar`}
            aria-expanded={isMobile ? mobileNavOpen : !sidebarCollapsed}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/90 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107]"
          >
            {isMobile && mobileNavOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
          </button>
          <TapTrackLogo responsive className="shrink-0" />
          <div className="min-w-0 sm:block">
            <p className="max-w-[112px] truncate text-xs font-semibold text-white sm:max-w-none sm:text-sm">{headerText.title}</p>
            <p className="hidden text-xs text-white/75 sm:block">{headerText.subtitle}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          {(user.role === 'instructor' || user.role === 'student') && <NotificationDropdown />}

          <div ref={profileRef} className="relative">
            <button
              ref={profileButtonRef}
              type="button"
              onClick={handleProfileClick}
              aria-label={`${user.username || 'Account'} account options`}
              aria-expanded={profileOpen}
              aria-controls="header-account-menu"
              className="flex min-h-10 items-center gap-2 rounded-lg px-1.5 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107] sm:gap-3 sm:px-2"
            >
              <UserAvatar user={user} size="sm" alt={`${user.username || 'User'} profile picture`} className="bg-[#FFC107] text-[#002B5B]" />
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium text-white">{user.username || 'User'}</p>
                <p className="text-xs text-white/75 capitalize">{user.role || 'user'}</p>
              </div>
              <ChevronDown size={16} className="text-[#FFC107]" aria-hidden="true" />
            </button>

            {profileOpen && (
              <div id="header-account-menu" role="group" aria-label="Account actions" className="absolute right-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[0_12px_28px_rgba(0,43,91,0.18)]">
                {user.role === 'instructor' && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setProfileOpen(false); navigate('/instructor/profile') }}
                      className="w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FFC107]"
                    >
                      Profile
                    </button>
                  </>
                )}
                {user.role === 'student' && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setProfileOpen(false); navigate('/student/profile') }}
                      className="w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FFC107]"
                    >
                      Profile
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => { setProfileOpen(false); handleLogout() }}
                  className="w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FFC107]"
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
