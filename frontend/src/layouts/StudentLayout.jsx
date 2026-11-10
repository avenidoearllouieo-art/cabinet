import { Outlet } from 'react-router-dom'
import WorkspaceLayout from './WorkspaceLayout'

export default function StudentLayout() {
  return (
    <WorkspaceLayout variant="student" shellClass="student-shell">
      <Outlet />
    </WorkspaceLayout>
  )
}
