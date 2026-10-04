const statusTones = {
  active: 'success',
  available: 'success',
  completed: 'success',
  graded: 'success',
  granted: 'success',
  published: 'success',
  success: 'success',
  submitted: 'success',
  registered: 'success',
  pending: 'warning',
  scheduled: 'warning',
  ongoing: 'warning',
  'due soon': 'warning',
  late: 'warning',
  overdue: 'danger',
  'due today': 'warning',
  'under review': 'warning',
  under_review: 'warning',
  returned_for_revision: 'warning',
  'returned for revision': 'warning',
  'not submitted': 'warning',
  'no instructor assigned': 'warning',
  denied: 'danger',
  failed: 'danger',
  missing: 'danger',
  'access denied': 'danger',
  rejected: 'danger',
  archived: 'neutral',
  closed: 'neutral',
  draft: 'neutral',
  empty: 'neutral',
  inactive: 'neutral',
  instructor: 'info',
  administrator: 'info',
  student: 'info',
  unknown: 'neutral',
}

export default function StatusBadge({ status, label, tone, icon: Icon, className = '' }) {
  const content = label ?? status ?? '—'
  const resolvedTone = tone || statusTones[String(status || content).toLowerCase()] || 'neutral'

  return (
    <span className={`tt-status tt-status-${resolvedTone} ${className}`.trim()}>
      {Icon && <Icon size={13} aria-hidden="true" />}
      {content}
    </span>
  )
}