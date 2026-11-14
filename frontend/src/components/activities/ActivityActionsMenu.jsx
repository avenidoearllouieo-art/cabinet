import { useState } from 'react'
import { MoreVertical, Eye, FileText } from 'lucide-react'
import AnchoredMenu from '../users/AnchoredMenu.jsx'

export default function ActivityActionsMenu({ activity, onAction }) {
  const [open, setOpen] = useState(false)
  if (!activity) return null

  const title = activity.title || 'activity'
  const item = (action, label, Icon) => (
    <button
      key={action}
      type="button"
      role="menuitem"
      onClick={() => {
        onAction?.(action, activity)
      }}
      className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#FFC107]"
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
      {item('view_submissions', 'View Submissions', FileText)}
    </AnchoredMenu>
  )
}