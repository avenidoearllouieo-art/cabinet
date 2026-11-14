import { useState } from 'react'
import { MoreVertical, Eye } from 'lucide-react'
import AnchoredMenu from '../users/AnchoredMenu.jsx'

export default function SubmissionActionsMenu({ submission, onAction }) {
  const [open, setOpen] = useState(false)
  if (!submission) return null
  const studentName = `${submission.student_name || ''} ${submission.student_last_name || ''}`.trim() || 'student'

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={setOpen}
      ariaLabel={`${studentName} submission actions`}
      renderTrigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`Actions for ${studentName}`}
          title="Submission actions"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-[#002B5B] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107]"
        >
          <MoreVertical size={17} aria-hidden="true" />
        </button>
      )}
    >
      <button type="button" role="menuitem" onClick={() => onAction?.('view', submission)} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"><Eye size={15} aria-hidden="true" />View</button>
    </AnchoredMenu>
  )
}