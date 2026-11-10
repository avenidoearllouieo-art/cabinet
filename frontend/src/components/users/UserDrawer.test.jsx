import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import api from '../../services/api.js'
import UserDrawer from './UserDrawer.jsx'

vi.mock('../../services/api.js', () => ({
  default: { get: vi.fn() },
}))

describe('UserDrawer nested history dialogs', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('closes the topmost access dialog before closing the profile drawer', async () => {
    const onClose = vi.fn()
    api.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith('/profile-details/')
        ? { counts: { access_logs: 1, activities: 0, submissions: 0 }, access_logs: [{ id: 1, action: 'unlock', status: 'success' }], activities: [], submissions: [] }
        : { count: 1, next: null, previous: null, results: [{ id: 1, action: 'unlock', status: 'success' }] },
    }))

    render(<UserDrawer user={{ id: 2, username: 'student', first_name: 'Student', last_name: 'One', role: 'student', is_active: true }} onClose={onClose} />)
    const viewAll = (await screen.findAllByRole('button', { name: 'View All' }))[0]
    fireEvent.click(viewAll)
    await screen.findByRole('dialog', { name: /Cabinet Access/ })
    expect(screen.getAllByRole('dialog')).toHaveLength(2)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})