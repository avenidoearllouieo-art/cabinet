import { Link, useLocation } from 'react-router-dom'
import { LayoutGrid, ClipboardList, Send, LogIn } from 'lucide-react'

const menuItems = [
  { label: 'Dashboard', path: '/student/dashboard', icon: LayoutGrid },
  { label: 'Activities', path: '/student/activities', icon: ClipboardList },
  { label: 'Submissions', path: '/student/submissions', icon: Send },
  { label: 'Access Logs', path: '/student/access-logs', icon: LogIn },
]

export default function StudentSidebar() {
  const location = useLocation()

  return (
    <aside className="fixed left-0 top-[70px] bottom-0 z-40 w-[250px] border-r border-slate-200 bg-white shadow-sm overflow-y-auto">
      <div className="px-6 py-6 border-b border-slate-200">
        <p className="text-sm font-semibold text-slate-900">Student Menu</p>
        <p className="mt-1 text-xs text-slate-500">View your tasks and activity history</p>
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
