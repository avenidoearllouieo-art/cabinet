import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import InstructorActivities from './InstructorActivities.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))

const activity = {
  id: 9,
  title: 'Cabinet Safety',
  status: 'Published',
  due_date: '2099-12-30T12:00:00Z',
  created_at: '2026-10-10T12:00:00Z',
  section: null,
  assigned_sections: [3],
}

describe('InstructorActivities', () => {
  beforeEach(() => {
    api.get.mockImplementation((path) => {
      if (path === '/activities/') return Promise.resolve({ data: { count: 1, next: null, results: [activity] } })
      if (path === '/sections/') return Promise.resolve({ data: { count: 1, next: null, results: [{ id: 3, section_name: 'Section A' }] } })
      throw new Error(`Unexpected GET ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('shows assigned section names, due status, and supported activity actions', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><InstructorActivities /></MemoryRouter>)

    expect(await screen.findByText('Cabinet Safety')).toBeTruthy()
    expect(screen.getByText('Section A')).toBeTruthy()
    expect(screen.getByText('Upcoming')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'More actions for Cabinet Safety' }))
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })
})
