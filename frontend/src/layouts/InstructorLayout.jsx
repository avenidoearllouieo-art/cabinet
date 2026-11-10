import { Outlet } from 'react-router-dom'
import WorkspaceLayout from './WorkspaceLayout'

export default function InstructorLayout() {
  return (
    <WorkspaceLayout variant="instructor" shellClass="instructor-shell">
      <Outlet />
    </WorkspaceLayout>
  )
}
    