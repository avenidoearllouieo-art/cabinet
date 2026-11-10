import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ActivityActionsMenu from './ActivityActionsMenu.jsx'

describe('ActivityActionsMenu', () => {
  afterEach(cleanup)

  it('routes actions to the selected activity', () => {
    const onAction = vi.fn()
    const activity = { id: 8, title: 'Cell structure', status: 'Published' }
    render(<ActivityActionsMenu activity={activity} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Cell structure' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))

    expect(onAction).toHaveBeenCalledWith('duplicate', activity)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not offer invalid lifecycle transitions', () => {
    render(<ActivityActionsMenu activity={{ id: 9, title: 'Closed activity', status: 'Closed' }} onAction={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Closed activity' }))

    expect(screen.getByRole('menuitem', { name: 'Close Activity' }).disabled).toBe(true)
    expect(screen.getByRole('menuitem', { name: 'Archive' }).disabled).toBe(false)
  })
})