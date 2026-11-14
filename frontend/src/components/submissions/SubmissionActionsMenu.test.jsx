import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SubmissionActionsMenu from './SubmissionActionsMenu.jsx'

describe('SubmissionActionsMenu', () => {
  afterEach(cleanup)

  it('routes View and does not offer Delete for the selected submission', () => {
    const onAction = vi.fn()
    const submission = { id: 21, student_name: 'Jordan', student_last_name: 'Santos' }
    render(<SubmissionActionsMenu submission={submission} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Jordan Santos' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))

    expect(onAction).toHaveBeenCalledWith('view', submission)
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})