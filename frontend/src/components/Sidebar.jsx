import { Link, useLocation } from 'react-router-dom'
import { LayoutGrid, Users, ClipboardList, Send, ShieldCheck, CalendarDays, Library, BookOpen, LogIn, KeyRound } from 'lucide-react'

const menuItems = [
  { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutGrid },
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Activities', path: '/admin/activities', icon: ClipboardList },
  { label: 'Submissions', path: '/admin/submissions', icon: Send },
  { label: 'Access Logs', path: '/admin/access-logs', icon: ShieldCheck },
  { label: 'Cabinet Sessions', path: '/admin/cabinet-sessions', icon: CalendarDays },
  { label: 'Password Recovery', path: '/admin/password-recovery-history', icon: KeyRound },
  { label: 'Sections', path: '/admin/sections', icon: Library },
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

export default function Sidebar({ variant = 'admin', collapsed = false, mobileOpen = false, onMobileClose }) {
  const location = useLocation()
  const config = sidebarVariants[variant] || sidebarVariants.admin
  const showLabels = !collapsed || mobileOpen

  return (
    <aside
      id={`${variant}-sidebar`}
      aria-label={`${config.title} navigation`}
      className={`app-sidebar fixed bottom-0 left-0 top-[70px] z-40 overflow-y-auto text-white transition-[width,transform] duration-300 ${collapsed ? 'min-[600px]:w-[76px]' : 'min-[600px]:w-[250px]'} max-[599.98px]:w-[260px] max-[599.98px]:max-w-[85vw] ${mobileOpen ? 'max-[599.98px]:visible max-[599.98px]:translate-x-0' : 'max-[599.98px]:invisible max-[599.98px]:-translate-x-full'}`}
    >
      <div className={`border-b border-white/10 py-4 ${showLabels ? 'px-5' : 'px-3'}`}>
        {showLabels && (
          <div className="mb-3">
            <p className="text-sm font-semibold text-white">{config.title}</p>
            <p className="mt-1 text-xs text-white/75">{config.subtitle}</p>
          </div>
        )}
      </div>
      <nav aria-label={`${config.title} navigation`} className="space-y-1 px-3 py-3">
        {config.items.map((item) => {
          const Icon = item.icon
          const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)

          return (
            <Link
              key={item.path}
              to={item.path}
              title={item.label}
              onClick={onMobileClose}
              aria-current={active ? 'page' : undefined}
              className={`flex h-11 items-center rounded-lg text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107] ${showLabels ? 'gap-3 px-4' : 'justify-center px-0'} ${
                active
                  ? 'bg-[#FFC107] font-bold text-[#071f41] shadow-[0_6px_16px_rgba(255,193,7,0.16)]'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
              <span className={showLabels ? 'truncate' : 'sr-only'}>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
