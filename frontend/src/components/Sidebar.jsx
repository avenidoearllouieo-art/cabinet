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
    <aside className={`app-sidebar fixed bottom-0 left-0 top-[70px] z-40 overflow-y-auto bg-[#071f41] text-white shadow-[8px_0_28px_rgba(0,43,91,0.08)] transition-[width] duration-300 ${collapsed ? 'w-[76px]' : 'w-[250px] max-sm:w-[76px]'}`}>
      <div className={`border-b border-white/10 py-5 ${collapsed ? 'px-3' : 'px-6 max-sm:px-3'}`}>
        <div className={`mb-5 flex ${collapsed ? 'justify-center' : 'justify-start max-sm:justify-center'}`}>
          <TapTrackLogo compact={collapsed} mobileCompact className={collapsed ? 'h-10 w-10' : 'h-auto w-[165px]'} />
        </div>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between gap-3 max-sm:justify-center'}`}>
          {!collapsed && <p className="text-sm font-semibold text-white max-sm:hidden">{config.title}</p>}
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/80 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#FFC107]"
            aria-label={collapsed ? `Expand ${config.title}` : `Collapse ${config.title}`}
            title={collapsed ? `Expand ${config.title}` : `Collapse ${config.title}`}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        {!collapsed && <p className="mt-1 text-xs text-white/75 max-sm:hidden">{config.subtitle}</p>}
      </div>
      <nav className="space-y-1 px-3 py-5">
        {config.items.map((item) => {
          const Icon = item.icon
          const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)

          return (
            <Link
              key={item.path}
              to={item.path}
              title={item.label}
              className={`flex h-11 items-center rounded-xl text-sm font-medium transition-colors ${collapsed ? 'justify-center px-0' : 'gap-3 px-4 max-sm:justify-center max-sm:px-0'} ${
                active
                  ? 'bg-[#FFC107] font-bold text-[#071f41] shadow-[0_6px_16px_rgba(255,193,7,0.16)]'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 2} />
                <span className={collapsed ? 'sr-only' : 'max-sm:sr-only'}>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
