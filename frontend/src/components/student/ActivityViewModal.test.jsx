import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import api from '../../services/api.js'
import ActivityViewModal from './ActivityViewModal.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))

describe('Student ActivityViewModal', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('keeps the four-step wizard and shows submission details without a duplicate submit action', async () => {
    const activity = {
      id: 7,
      title: 'Systems Lab',
      status: 'Published',
      due_date: null,
      attachments: [],
      student_submission_status: 'Not Submitted',
    }
    api.get.mockImplementation((path) => {
      if (path === '/activities/7/') return Promise.resolve({ data: activity })
      if (path === '/submissions/') return Promise.resolve({ data: { results: [] } })
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<ActivityViewModal activity={activity} isOpen onClose={vi.fn()} />)

    expect(await screen.findByText('No deadline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Attachments' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Your Submission' })).toBeTruthy()
    expect(screen.getByText('Not Submitted')).toBeTruthy()
    expect(screen.getByText('Not submitted')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit Activity' })).toBeNull()
    expect(api.post).not.toHaveBeenCalled()
    expect(api.patch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Attachments' })).toBeTruthy()
  })
})