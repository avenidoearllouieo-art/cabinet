import { Navigate, Outlet } from 'react-router-dom'

export default function ProtectedRoute({ redirectTo = '/' }) {
  const accessToken = localStorage.getItem('access')
  const normalizedToken = accessToken && accessToken !== 'undefined' && accessToken !== 'null' ? accessToken : null

  if (!normalizedToken) {
    return <Navigate to={redirectTo} replace />
  }

  return <Outlet />
}
