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
  const details = [
    ['Full name', fullName || 'Not available'],
    ['Username', user?.username || 'Not available'],
    ['Email address', user?.email || 'Not available'],
    [identifierLabel, identifier ?? 'Not available'],
    ['Account role', roleLabel(user?.role)],
    ['Assigned section(s)', assignedSectionNames(user || {}, role)],
    ['Account status', user?.is_active == null ? 'Not available' : user.is_active ? 'Active' : 'Inactive'],
    ['NFC registration', registered ? 'Registered' : 'Not registered'],
    ['Date joined', joinedDate(user || {})],
  ]

  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
      {details.map(([label, value]) => (
        <div key={label} className="min-w-0 border-b border-slate-200/80 pb-2">
          <dt className="text-[11px] font-semibold uppercase text-slate-500">{label}</dt>
          <dd className="mt-0.5 min-w-0 break-words text-sm font-medium text-[#102a4c]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
