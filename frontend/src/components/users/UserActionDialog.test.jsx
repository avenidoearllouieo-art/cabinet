import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import UserActionDialog from './UserActionDialog.jsx'

describe('UserActionDialog', () => {
  afterEach(cleanup)

  it('requires explicit confirmation before replacing an NFC UID', () => {
    const onConfirm = vi.fn()
    render(
      <UserActionDialog
        action="assign_nfc"
        user={{ id: 4, username: 'jordan', first_name: 'Jordan', last_name: 'Santos', nfc_uid: 'OLD-UID' }}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'NFC UID' })
    fireEvent.change(input, { target: { value: 'NEW-UID' } })
    const saveButton = screen.getByRole('button', { name: 'Save NFC UID' })
    expect(saveButton.disabled).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox'))
    expect(saveButton.disabled).toBe(false)
    fireEvent.click(saveButton)
    expect(onConfirm).toHaveBeenCalledWith({ nfc_uid: 'NEW-UID' })
  })

  it('explains that admin password recovery uses the verified student flow', () => {
    render(<UserActionDialog action="reset_password" user={{ student_id: 'STU-1', username: 'jordan' }} onClose={() => {}} />)
    expect(screen.getByText(/verify their registered NFC card at the cabinet/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Forgot Password' })).toBeTruthy()
  })

  it('names the affected count and confirms bulk deletion explicitly', () => {
    const onConfirm = vi.fn()
    render(<UserActionDialog action="bulk_delete" count={3} onConfirm={onConfirm} onClose={() => {}} />)

    expect(screen.getByText(/affects 3 selected accounts/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete accounts' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})