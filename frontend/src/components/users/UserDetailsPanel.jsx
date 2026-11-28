import ExpandedDetailsGrid from '../ExpandedDetailsGrid.jsx'

function roleLabel(role) {
  const normalized = String(role || '').toLowerCase()
  if (normalized === 'admin' || normalized === 'administrator') return 'Administrator'
  if (normalized === 'instructor') return 'Instructor'
  if (normalized === 'student') return 'Student'
  return role || 'Not available'
}

function joinedDate(user) {
  if (!user.created_at) return 'Not available'
  const date = new Date(user.created_at)
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

function assignedSectionNames(user, role) {
  if (role === 'instructor') {
    const names = (Array.isArray(user.assigned_sections) ? user.assigned_sections : [])
      .map((section) => section?.section_name || section?.section)
      .filter(Boolean)
    return names.length ? names.join(', ') : 'Not assigned'
  }
  if (role === 'student') return user.section_name || 'Not assigned'
  return 'Not assigned'
}

export default function UserDetailsPanel({ user }) {
  const role = String(user?.role || '').toLowerCase()
  const fullName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim()
  const identifier = role === 'student'
    ? user?.student_id || user?.id
    : role === 'instructor'
      ? user?.instructor_id || user?.id
      : user?.id
  const identifierLabel = role === 'student'
    ? 'Student ID / User ID'
    : role === 'instructor'
      ? 'Instructor ID / User ID'
      : 'User ID'
  const registered = typeof user?.nfc_registered === 'boolean'
    ? user.nfc_registered
    : Boolean(user?.nfc_uid)
  const accountRegistrationStatus = !user?.is_active
    ? 'Inactive'
    : (user?.registration_status || (user?.username ? 'registered' : 'pending_registration')) === 'registered'
      ? 'Registered'
      : 'Pending Registration'
  const details = [
    ['Full name', fullName || 'Not available'],
    ['Username', user?.username || 'Not available'],
    ['Email address', user?.email || 'Not available'],
    [identifierLabel, identifier ?? 'Not available'],
    ['Account role', roleLabel(user?.role)],
    ['Assigned section(s)', assignedSectionNames(user || {}, role)],
    ['Account status', user?.is_active == null ? 'Not available' : user.is_active ? 'Active' : 'Inactive'],
    ['Registration status', accountRegistrationStatus],
    ['NFC registration', registered ? 'Registered' : 'Not registered'],
    ['Date joined', joinedDate(user || {})],
  ]

  return (
    <ExpandedDetailsGrid
      columns="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
      items={details.map(([label, value]) => ({ label, value }))}
    />
  )
}
