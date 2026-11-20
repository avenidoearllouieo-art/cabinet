import { useState } from 'react'
import { MoreVertical, Eye, Edit2, Wifi, KeyRound, ShieldCheck, UserRoundCheck, UserRoundX, Trash2 } from 'lucide-react'
import AnchoredMenu from './AnchoredMenu.jsx'

export default function ActionsMenu({ user, onAction, protectedAccount = false, canIssueRegistrationPins = false }) {
  const [open, setOpen] = useState(false)
  if (!user) return null

  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'user'
  const menuItem = (action, label, Icon, { disabled = false, danger = false } = {}) => (
    <button
      key={action}
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        onAction?.(action, user)
      }}
      className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#FFC107] disabled:cursor-not-allowed disabled:opacity-45 ${danger ? 'text-red-700 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}
      title={disabled ? 'This action could lock out the current administrator.' : undefined}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  )

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={setOpen}
      ariaLabel={`${fullName} actions`}
      renderTrigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`Actions for ${fullName}`}
          title="User actions"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-[#002B5B] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107]"
        >
          <MoreVertical size={18} aria-hidden="true" />
        </button>
      )}
    >
      {menuItem('view', 'View Profile', Eye)}
      {menuItem('edit', 'Edit User', Edit2)}
      {menuItem('assign_nfc', user.nfc_uid ? 'Change NFC UID' : 'Assign NFC UID', Wifi)}
      {canIssueRegistrationPins && user.registration_status === 'pending_registration' && menuItem('issue_registration_pin', 'Issue Registration PIN', ShieldCheck)}
      {user.role === 'student' && menuItem('reset_password', 'Reset Password', KeyRound)}
      <div className="my-1 border-t border-slate-100" role="separator" />
      {menuItem(user.is_active ? 'deactivate' : 'activate', user.is_active ? 'Deactivate Account' : 'Activate Account', user.is_active ? UserRoundX : UserRoundCheck, { disabled: protectedAccount })}
      {menuItem('delete', 'Delete Account', Trash2, { disabled: protectedAccount, danger: true })}
    </AnchoredMenu>
  )
}
