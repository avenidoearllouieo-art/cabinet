import { Link, useLocation } from 'react-router-dom'
import { LayoutGrid, ClipboardList, Send, BookOpen, LogIn, Bell } from 'lucide-react'

const menuItems = [
  { label: 'Dashboard', path: '/instructor/dashboard', icon: LayoutGrid },
  { label: 'Sections', path: '/instructor/sections', icon: BookOpen },
  { label: 'Access Logs', path: '/instructor/access-logs', icon: LogIn },
  { label: 'Activities', path: '/instructor/activities', icon: ClipboardList },
  { label: 'Submissions', path: '/instructor/submissions', icon: Send },
  // Notifications removed from sidebar to use top-right bell instead
]

export default function InstructorSidebar() {
  const location = useLocation()

  return (
    <aside className="fixed left-0 top-[70px] bottom-0 z-40 w-[250px] border-r border-slate-200 bg-white shadow-sm overflow-y-auto">
      <div className="px-6 py-6 border-b border-slate-200">
        <p className="text-sm font-semibold text-slate-900">Instructor Menu</p>
        <p className="mt-1 text-xs text-slate-500">Manage your activities and submissions</p>
      </div>
      <nav className="px-2 py-4 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon
          const active = location.pathname === item.path

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex h-12 items-center gap-3 rounded-xl px-4 text-sm font-medium transition-colors ${
                active
                  ? 'bg-slate-100 text-slate-900 shadow-sm'
                  : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
