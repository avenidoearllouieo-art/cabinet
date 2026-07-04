import { Link, useLocation } from 'react-router-dom'
import { LayoutGrid, Users, ClipboardList, Send, ShieldCheck, CalendarDays, Library, Settings } from 'lucide-react'

const menuItems = [
  { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutGrid },
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Activities', path: '/admin/activities', icon: ClipboardList },
  { label: 'Submissions', path: '/admin/submissions', icon: Send },
  { label: 'Access Logs', path: '/admin/access-logs', icon: ShieldCheck },
  { label: 'Cabinet Events', path: '/admin/cabinet-events', icon: CalendarDays },
  { label: 'Sections', path: '/admin/sections', icon: Library },
  { label: 'Settings', path: '/admin/settings', icon: Settings },
]

export default function Sidebar() {
  const location = useLocation()

  return (
    <aside className="fixed left-0 top-[70px] bottom-0 z-40 w-[250px] border-r border-slate-200 bg-white shadow-sm overflow-y-auto">
      <div className="px-6 py-6 border-b border-slate-200">
        <p className="text-sm font-semibold text-slate-900">Admin Menu</p>
        <p className="mt-1 text-xs text-slate-500">Manage users, events, and logs</p>
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
