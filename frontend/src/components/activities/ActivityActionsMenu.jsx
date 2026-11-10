import { useState } from 'react'
import { MoreVertical, Eye, Pencil, Copy, Layers3, FileText, CircleX, Archive, Trash2 } from 'lucide-react'
import AnchoredMenu from '../users/AnchoredMenu.jsx'

export default function ActivityActionsMenu({ activity, onAction }) {
  const [open, setOpen] = useState(false)
  if (!activity) return null

  const status = String(activity.status || 'Published').trim().toLowerCase()
  const canClose = ['published', 'active', 'scheduled'].includes(status)
  const canArchive = status !== 'archived'
  const title = activity.title || 'activity'
  const item = (action, label, Icon, { disabled = false, danger = false } = {}) => (
    <button
      key={action}
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (!disabled) onAction?.(action, activity)
      }}
      className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#FFC107] disabled:cursor-not-allowed disabled:opacity-45 ${danger ? 'text-red-700 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}
      title={disabled ? `This activity is already ${status}.` : undefined}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>
  )

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={setOpen}
      ariaLabel={`${title} actions`}
      renderTrigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`Actions for ${title}`}
          title="Activity actions"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-[#002B5B] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107]"
        >
          <MoreVertical size={18} aria-hidden="true" />
        </button>
      )}
    >
      {item('view', 'View', Eye)}
      {item('edit', 'Edit', Pencil)}
      {item('duplicate', 'Duplicate', Copy)}
      <div className="my-1 border-t border-slate-100" role="separator" />
      {item('assign_sections', 'Assign Sections', Layers3)}
      {item('view_submissions', 'View Submissions', FileText)}
      <div className="my-1 border-t border-slate-100" role="separator" />
      {item('close', 'Close Activity', CircleX, { disabled: !canClose })}
      {item('archive', 'Archive', Archive, { disabled: !canArchive })}
      <div className="my-1 border-t border-slate-100" role="separator" />
      {item('delete', 'Delete', Trash2, { danger: true })}
    </AnchoredMenu>
  )
}