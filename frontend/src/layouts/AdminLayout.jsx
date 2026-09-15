import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'

export default function AdminLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('admin-sidebar-collapsed') === 'true')

  return (
    <div className="min-h-screen w-full bg-white text-[#111827]">
      <Header />
      <div className="flex min-h-screen items-stretch justify-start pt-[70px]">
        <Sidebar variant="admin" onCollapsedChange={setSidebarCollapsed} />
        <main className={`${sidebarCollapsed ? 'ml-[76px]' : 'ml-[250px] max-sm:ml-[76px]'} flex-1 min-w-0 bg-white p-6 transition-[margin] duration-300 sm:p-8`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
