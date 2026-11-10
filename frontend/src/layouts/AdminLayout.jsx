import { Outlet } from 'react-router-dom'
import WorkspaceLayout from './WorkspaceLayout'

export default function AdminLayout() {
  return (
    <WorkspaceLayout variant="admin" shellClass="admin-shell">
      <Outlet />
    </WorkspaceLayout>
  )
}
