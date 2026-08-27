import { Navigate, Outlet } from 'react-router-dom'

const loginRouteForRole = {
  admin: '/admin/login',
  instructor: '/instructor/login',
  student: '/student/login',
}

export default function ProtectedRoute({ redirectTo = '/', allowedRoles = [] }) {
  const accessToken = localStorage.getItem('access')
  const normalizedToken = accessToken && accessToken !== 'undefined' && accessToken !== 'null' ? accessToken : null

  if (!normalizedToken) {
    return <Navigate to={redirectTo} replace />
  }

  let user
  try {
    user = JSON.parse(localStorage.getItem('user') || 'null')
  } catch {
    localStorage.removeItem('access')
    localStorage.removeItem('refresh')
    localStorage.removeItem('user')
    return <Navigate to={redirectTo} replace />
  }

  const role = String(user?.role || '').toLowerCase()
  if (allowedRoles.length && !allowedRoles.includes(role)) {
    return <Navigate to={loginRouteForRole[role] || redirectTo} replace />
  }

  return <Outlet />
}
