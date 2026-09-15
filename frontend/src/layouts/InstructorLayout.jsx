import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'

export default function InstructorLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('instructor-sidebar-collapsed') === 'true')

  return (
    <div className="min-h-screen w-full bg-white text-[#111827]">
      <Header />
      <div className="flex min-h-screen pt-[70px] items-stretch justify-start">
        <Sidebar variant="instructor" onCollapsedChange={setSidebarCollapsed} />
        <main className={`${sidebarCollapsed ? 'ml-[76px]' : 'ml-[250px] max-sm:ml-[76px]'} flex-1 min-h-screen min-w-0 bg-white p-6 transition-[margin] duration-300 sm:p-8`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
    