import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ActivityActionsMenu from './ActivityActionsMenu.jsx'

describe('ActivityActionsMenu', () => {
  afterEach(cleanup)

  it('routes View Submissions to the selected activity', () => {
    const onAction = vi.fn()
    const activity = { id: 8, title: 'Cell structure', status: 'Published' }
    render(<ActivityActionsMenu activity={activity} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Cell structure' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View Submissions' }))

    expect(onAction).toHaveBeenCalledWith('view_submissions', activity)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers only read-only activity actions', () => {
    render(<ActivityActionsMenu activity={{ id: 9, title: 'Closed activity', status: 'Closed' }} onAction={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Closed activity' }))

    expect(screen.getByRole('menuitem', { name: 'View' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'View Submissions' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Edit|Duplicate|Close Activity|Archive|Delete/ })).toBeNull()
  })
})