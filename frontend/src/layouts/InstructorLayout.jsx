import { Outlet } from 'react-router-dom'
import Header from '../components/Header'
import InstructorSidebar from '../components/InstructorSidebar'

export default function InstructorLayout() {
  return (
    <div className="min-h-screen w-full bg-white text-[#111827]">
      <Header />
      <div className="flex min-h-screen pt-[70px] items-stretch justify-start">
        <InstructorSidebar />
        <main className="ml-[250px] flex-1 min-h-screen min-w-0 bg-[#F8FAFC] p-6 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
    