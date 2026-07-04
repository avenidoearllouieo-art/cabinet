import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AppHeader() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [userName] = useState(() => {
    try {
      const userData = JSON.parse(localStorage.getItem('user') || '{}')
      return userData.first_name || userData.username || 'Admin'
    } catch {
      return 'Admin'
    }
  })
  
  const [userRole] = useState(() => {
    try {
      const userData = JSON.parse(localStorage.getItem('user') || '{}')
      return userData.role || 'admin'
    } catch {
      return 'admin'
    }
  })

  const handleLogout = () => {
    localStorage.removeItem('access')
    localStorage.removeItem('refresh')
    localStorage.removeItem('user')
    navigate('/')
  }

  const handleSearch = (e) => {
    e.preventDefault()
    // Search functionality can be implemented later
    console.log('Search:', searchQuery)
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-[70px] bg-white border-b border-slate-200 shadow-sm">
      <div className="h-full px-6 flex items-center justify-between gap-6">
        {/* Left side - Logo and system name */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
            TT
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-sm">TapTrack</h1>
            <p className="text-xs text-slate-500">System Manager</p>
          </div>
        </div>

        {/* Center - Search bar */}
        <div className="flex-1 max-w-md">
          <form onSubmit={handleSearch}>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search students, assignments, or settings..."
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
              <button
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                🔍
              </button>
            </div>
          </form>
        </div>

        {/* Right side - Notifications, user info and logout */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {/* Notification icon */}
          <button className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors flex items-center justify-center text-slate-600">
            🔔
          </button>

          <div className="w-px h-6 bg-slate-200" />

          <div className="text-right">
            <p className="font-semibold text-slate-900 text-sm">{userName}</p>
            <p className="text-xs text-slate-500 capitalize">{userRole}</p>
          </div>
          
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-500 flex items-center justify-center text-white font-semibold text-sm">
            {userName.charAt(0).toUpperCase()}
          </div>

          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors duration-200"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}
