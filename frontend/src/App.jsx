import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/auth/Login.jsx'
import AdminLayout from './layouts/AdminLayout.jsx'
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import Users from './pages/admin/Users.jsx'
import Activities from './pages/admin/Activities.jsx'
import Submissions from './pages/admin/Submissions.jsx'
import AccessLogs from './pages/admin/AccessLogs.jsx'
import CabinetEvents from './pages/admin/CabinetEvents.jsx'
import Sections from './pages/admin/Sections.jsx'
import InstructorLayout from './layouts/InstructorLayout.jsx'
import InstructorDashboard from './pages/instructor/InstructorDashboard.jsx'
import InstructorActivities from './pages/instructor/InstructorActivities.jsx'
import ActivityDetailsPage from './pages/instructor/ActivityDetailsPage.jsx'
import InstructorSubmissions from './pages/instructor/InstructorSubmissions.jsx'
import InstructorSections from './pages/instructor/InstructorSections.jsx'
import InstructorSectionStudents from './pages/instructor/InstructorSectionStudents.jsx'
import InstructorStudentProfile from './pages/instructor/InstructorStudentProfile.jsx'
import InstructorProfile from './pages/instructor/InstructorProfile.jsx'
import InstructorChangePassword from './pages/instructor/InstructorChangePassword.jsx'
import InstructorAccessLogs from './pages/instructor/InstructorAccessLogs.jsx'
import InstructorNotifications from './pages/instructor/InstructorNotifications.jsx'
import StudentLayout from './layouts/StudentLayout.jsx'
import StudentDashboard from './pages/student/StudentDashboard.jsx'
import StudentActivities from './pages/student/StudentActivities.jsx'
import StudentSubmissions from './pages/student/StudentSubmissions.jsx'
import StudentAccessLogs from './pages/student/StudentAccessLogs.jsx'
import StudentProfile from './pages/student/StudentProfile.jsx'
import StudentChangePassword from './pages/student/StudentChangePassword.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import './App.css'

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
      <Routes>
        <Route path='/' element={<Login />} />
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
    </BrowserRouter>
  )
}

export default App
