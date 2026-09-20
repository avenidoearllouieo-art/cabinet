import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/auth/Login.jsx'
import ForgotPassword from './pages/auth/ForgotPassword.jsx'
import AdminLayout from './layouts/AdminLayout.jsx'
import InstructorLayout from './layouts/InstructorLayout.jsx'
import StudentLayout from './layouts/StudentLayout.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import './App.css'

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'))
const Users = lazy(() => import('./pages/admin/Users.jsx'))
const Activities = lazy(() => import('./pages/admin/Activities.jsx'))
const Submissions = lazy(() => import('./pages/admin/Submissions.jsx'))
const AccessLogs = lazy(() => import('./pages/admin/AccessLogs.jsx'))
const CabinetEvents = lazy(() => import('./pages/admin/CabinetEvents.jsx'))
const Sections = lazy(() => import('./pages/admin/Sections.jsx'))
const InstructorDashboard = lazy(() => import('./pages/instructor/InstructorDashboard.jsx'))
const InstructorActivities = lazy(() => import('./pages/instructor/InstructorActivities.jsx'))
const ActivityDetailsPage = lazy(() => import('./pages/instructor/ActivityDetailsPage.jsx'))
const InstructorSubmissions = lazy(() => import('./pages/instructor/InstructorSubmissions.jsx'))
const InstructorSections = lazy(() => import('./pages/instructor/InstructorSections.jsx'))
const InstructorSectionStudents = lazy(() => import('./pages/instructor/InstructorSectionStudents.jsx'))
const InstructorStudentProfile = lazy(() => import('./pages/instructor/InstructorStudentProfile.jsx'))
const InstructorProfile = lazy(() => import('./pages/instructor/InstructorProfile.jsx'))
const InstructorChangePassword = lazy(() => import('./pages/instructor/InstructorChangePassword.jsx'))
const InstructorAccessLogs = lazy(() => import('./pages/instructor/InstructorAccessLogs.jsx'))
const InstructorNotifications = lazy(() => import('./pages/instructor/InstructorNotifications.jsx'))
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard.jsx'))
const StudentActivities = lazy(() => import('./pages/student/StudentActivities.jsx'))
const StudentSubmissions = lazy(() => import('./pages/student/StudentSubmissions.jsx'))
const StudentAccessLogs = lazy(() => import('./pages/student/StudentAccessLogs.jsx'))
const StudentProfile = lazy(() => import('./pages/student/StudentProfile.jsx'))
const StudentChangePassword = lazy(() => import('./pages/student/StudentChangePassword.jsx'))

// Placeholder page component for pages under construction
function PagePlaceholder({ title, description }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        <p className="text-slate-600 mt-2">{description}</p>
      </div>
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-slate-500 text-lg">Coming soon</p>
      </div>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-50 text-sm font-medium text-slate-600">Loading TapTrack…</div>}>
        <Routes>
        <Route path='/' element={<Login />} />
        <Route path='/forgot-password' element={<ForgotPassword />} />
        <Route path='/admin/login' element={<Login administratorOnly />} />
        <Route path='/instructor/login' element={<Login />} />
        <Route path='/student/login' element={<Login />} />

        <Route element={<ProtectedRoute redirectTo='/admin/login' allowedRoles={['admin']} />}>
        <Route path='/admin' element={<AdminLayout />}>
          <Route index element={<Navigate to='dashboard' replace />} />
          <Route path='dashboard' element={<AdminDashboard />} />
          <Route path='users' element={<Users />} />
          <Route path='activities' element={<Activities />} />
          <Route path='submissions' element={<Submissions />} />
          <Route path='access-logs' element={<AccessLogs />} />
          <Route path='cabinet-events' element={<CabinetEvents />} />
          <Route path='sections' element={<Sections />} />
          <Route
            path='settings'
            element={
              <PagePlaceholder 
                title="Settings" 
                description="Configure system settings and preferences"
              />
            }
          />
        </Route>
        </Route>

        <Route element={<ProtectedRoute redirectTo='/student/login' allowedRoles={['student']} />}>
          <Route path='/student' element={<StudentLayout />}>
            <Route index element={<Navigate to='dashboard' replace />} />
            <Route path='dashboard' element={<StudentDashboard />} />
            <Route path='activities' element={<StudentActivities />} />
            <Route path='submissions' element={<StudentSubmissions />} />
            <Route path='access-logs' element={<StudentAccessLogs />} />
            <Route path='profile' element={<StudentProfile />} />
            <Route path='profile/change-password' element={<StudentChangePassword />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute redirectTo='/instructor/login' allowedRoles={['instructor']} />}>
          <Route path='/instructor' element={<InstructorLayout />}>
            <Route index element={<Navigate to='dashboard' replace />} />
            <Route path='dashboard' element={<InstructorDashboard />} />
            <Route path='sections' element={<InstructorSections />} />
            <Route path='sections/:sectionId/students' element={<InstructorSectionStudents />} />
            <Route path='students/:studentId' element={<InstructorStudentProfile />} />
            <Route path='profile' element={<InstructorProfile />} />
            <Route path='profile/change-password' element={<InstructorChangePassword />} />
            <Route path='activities' element={<InstructorActivities />} />
            <Route path='activities/:activityId' element={<ActivityDetailsPage />} />
            <Route path='submissions' element={<InstructorSubmissions />} />
            <Route path='access-logs' element={<InstructorAccessLogs />} />
            <Route path='notifications' element={<InstructorNotifications />} />
          </Route>
        </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
