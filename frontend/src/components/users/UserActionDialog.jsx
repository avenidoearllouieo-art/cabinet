import { useState } from 'react'
import Modal from '../Modal.jsx'

const actionLabels = {
  activate: { title: 'Activate account', confirm: 'Activate account' },
  deactivate: { title: 'Deactivate account', confirm: 'Deactivate account' },
  delete: { title: 'Delete account', confirm: 'Delete account' },
  bulk_activate: { title: 'Activate selected accounts', confirm: 'Activate accounts' },
  bulk_deactivate: { title: 'Deactivate selected accounts', confirm: 'Deactivate accounts' },
  bulk_delete: { title: 'Delete selected accounts', confirm: 'Delete accounts' },
}

export default function UserActionDialog({ action, user, count = 0, busy = false, error = '', onClose, onConfirm }) {
  const [nfcUid, setNfcUid] = useState(user?.nfc_uid || '')
  const [replacementConfirmed, setReplacementConfirmed] = useState(false)
  const [validationError, setValidationError] = useState('')

  if (!action) return null

  const isNfc = action === 'assign_nfc'
  const isRecovery = action === 'reset_password'
  const bulkAction = action.startsWith('bulk_')
  const config = actionLabels[action]
  const displayName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.username || 'this user'
  const replacingUid = Boolean(user?.nfc_uid && user.nfc_uid !== nfcUid.trim())
  const destructive = action.includes('delete') || action.includes('deactivate')

  const confirm = () => {
    if (isNfc) {
      const value = nfcUid.trim()
      if (!value) return setValidationError('Enter an NFC UID to continue.')
      if (replacingUid && !replacementConfirmed) return setValidationError('Confirm that the existing NFC UID should be replaced.')
      onConfirm?.({ nfc_uid: value })
      return
    }
    onConfirm?.()
  }

  const title = isNfc ? 'Assign NFC UID' : isRecovery ? 'Password recovery' : config.title
  const confirmLabel = isNfc ? 'Save NFC UID' : isRecovery ? 'Open Forgot Password' : config.confirm

  return (
    <Modal
      isOpen={Boolean(action)}
      onClose={onClose}
      title={title}
      description={isNfc ? `Update the NFC credential for ${displayName}.` : isRecovery ? `Recovery information for ${displayName}.` : undefined}
      busy={busy}
      maxWidth="520px"
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="tt-button tt-button-secondary w-full sm:w-auto">Cancel</button>
          <button type="button" onClick={confirm} disabled={busy || (isNfc && replacingUid && !replacementConfirmed)} className={`tt-button w-full sm:w-auto ${destructive ? 'tt-button-danger' : 'tt-button-primary'}`}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {validationError && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{validationError}</p>}

        {isNfc ? (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-800">{displayName}</p>
              <p className="mt-1 text-slate-600">{user?.username || 'Username unavailable'} · {user?.nfc_uid ? 'NFC registered' : 'No NFC UID assigned'}</p>
              {user?.nfc_uid && <p className="mt-2 break-all font-mono text-xs text-slate-500">Current UID: {user.nfc_uid}</p>}
            </div>
            <label className="block text-sm font-semibold text-slate-700" htmlFor="user-nfc-uid">NFC UID</label>
            <input id="user-nfc-uid" value={nfcUid} onChange={(event) => { setNfcUid(event.target.value); setValidationError('') }} autoComplete="off" className="tt-control w-full" aria-describedby="nfc-assignment-note" />
            <p id="nfc-assignment-note" className="text-xs leading-5 text-slate-500">Enter the UID obtained through the authorized cabinet enrollment process. This form does not scan or verify a card; the server enforces UID uniqueness.</p>
            {replacingUid && (
              <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <input type="checkbox" checked={replacementConfirmed} onChange={(event) => setReplacementConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>Replace the existing UID for {displayName}.</span>
              </label>
            )}
          </>
        ) : isRecovery ? (
          <div className="space-y-3 text-sm leading-6 text-slate-700">
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
              <p className="font-semibold text-[#002B5B]">{displayName}</p>
              <p className="text-slate-600">Student ID: {user?.student_id || 'Unavailable'}</p>
            </div>
            <p>The existing recovery process requires the student to request a reset with their Student ID and email, then verify their registered NFC card at the cabinet. Admin-initiated password changes and recovery-request status are not available in the current API.</p>
            {!user?.student_id && <p role="alert" className="text-amber-800">This account has no Student ID, so the existing recovery form may not support it.</p>}
          </div>
        ) : (
          <div className="space-y-3 text-sm leading-6 text-slate-700">
            <p>{bulkAction ? `This action affects ${count} selected account${count === 1 ? '' : 's'}.` : `This action affects ${displayName} (${user?.username || 'username unavailable'}).`}</p>
            {action.includes('delete') && <p className="rounded-lg border border-red-200 bg-red-50 p-3 font-medium text-red-800">Account deletion is permanent. Related academic and cabinet records are governed by existing backend deletion constraints.</p>}
            {action.includes('deactivate') && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">This account will no longer be able to sign in until reactivated.</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}