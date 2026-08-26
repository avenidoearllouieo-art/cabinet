import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { LayoutGrid, Users, ClipboardList, Send, ShieldCheck, CalendarDays, Library, Settings, BookOpen, LogIn, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import TapTrackLogo from './TapTrackLogo.jsx'

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

const studentMenuItems = [
  { label: 'Dashboard', path: '/student/dashboard', icon: LayoutGrid },
  { label: 'Activities', path: '/student/activities', icon: ClipboardList },
  { label: 'Submissions', path: '/student/submissions', icon: Send },
  { label: 'Access Logs', path: '/student/access-logs', icon: LogIn },
]

const instructorMenuItems = [
  { label: 'Dashboard', path: '/instructor/dashboard', icon: LayoutGrid },
  { label: 'Sections', path: '/instructor/sections', icon: BookOpen },
  { label: 'Access Logs', path: '/instructor/access-logs', icon: LogIn },
  { label: 'Activities', path: '/instructor/activities', icon: ClipboardList },
  { label: 'Submissions', path: '/instructor/submissions', icon: Send },
]

const sidebarVariants = {
  admin: { title: 'Admin Menu', subtitle: 'Manage users, events, and logs', items: menuItems },
  student: { title: 'Student Menu', subtitle: 'View your tasks and activity history', items: studentMenuItems },
  instructor: { title: 'Instructor Menu', subtitle: 'Manage your activities and submissions', items: instructorMenuItems },
}

export default function Sidebar({ variant = 'admin', onCollapsedChange }) {
  const location = useLocation()
  const config = sidebarVariants[variant] || sidebarVariants.admin
  const storageKey = `${variant}-sidebar-collapsed`
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(storageKey) === 'true')

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current
      localStorage.setItem(storageKey, String(next))
      onCollapsedChange?.(next)
      return next
    })
  }

  return (
    <aside className={`fixed bottom-0 left-0 top-[70px] z-40 overflow-y-auto border-r border-slate-200 bg-white shadow-sm transition-[width] duration-300 ${collapsed ? 'w-[76px]' : 'w-[250px] max-sm:w-[76px]'}`}>
      <div className={`border-b border-slate-200 py-5 ${collapsed ? 'px-3' : 'px-6 max-sm:px-3'}`}>
        <div className={`mb-5 flex ${collapsed ? 'justify-center' : 'justify-start max-sm:justify-center'}`}>
          <TapTrackLogo compact={collapsed} mobileCompact className={collapsed ? 'h-10 w-10' : 'h-auto w-[165px]'} />
        </div>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between gap-3 max-sm:justify-center'}`}>
          {!collapsed && <p className="text-sm font-semibold text-slate-900 max-sm:hidden">{config.title}</p>}
          <button
            type="button"
            onClick={toggleSidebar}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label={collapsed ? `Expand ${config.title}` : `Collapse ${config.title}`}
            title={collapsed ? `Expand ${config.title}` : `Collapse ${config.title}`}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        {!collapsed && <p className="mt-1 text-xs text-slate-500 max-sm:hidden">{config.subtitle}</p>}
      </div>
      <nav className="px-2 py-4 space-y-1">
        {config.items.map((item) => {
          const Icon = item.icon
          const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)

          return (
            <Link
              key={item.path}
              to={item.path}
              title={item.label}
              className={`flex h-12 items-center rounded-xl text-sm font-medium transition-colors ${collapsed ? 'justify-center px-0' : 'gap-3 px-4 max-sm:justify-center max-sm:px-0'} ${
                active
                  ? 'bg-slate-100 text-slate-900 shadow-sm'
                  : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon size={18} />
              <span className={collapsed ? 'sr-only' : 'max-sm:sr-only'}>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
