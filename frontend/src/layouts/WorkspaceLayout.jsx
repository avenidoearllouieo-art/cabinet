import { useEffect, useState } from 'react'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'

export default function WorkspaceLayout({ variant, shellClass, children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    if (!mobileNavOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mobileNavOpen])

  const toggleNavigation = () => {
    if (window.innerWidth < 600) {
      setMobileNavOpen((open) => !open)
      return
    }

    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
  }

  return (
    <div className={`${shellClass} min-h-screen w-full overflow-x-clip bg-[#f4f7fb] text-[#14243a]`}>
      <Header
        sidebarCollapsed={sidebarCollapsed}
        mobileNavOpen={mobileNavOpen}
        onMenuToggle={toggleNavigation}
      />
      <div className="flex min-h-screen items-stretch justify-start pt-[70px]">
        {mobileNavOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-x-0 bottom-0 top-[70px] z-30 bg-[#071f41]/40 min-[600px]:hidden"
          />
        )}
        <Sidebar
          variant={variant}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />
        <main className={`admin-main ml-0 min-w-0 flex-1 p-4 transition-[margin] duration-300 min-[600px]:p-6 lg:p-8 ${sidebarCollapsed ? 'min-[600px]:ml-[76px]' : 'min-[600px]:ml-[250px]'}`}>
          {children}
        </main>
      </div>
    </div>
  )
}