import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import Activities from './Activities.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

const activity = {
  id: 1,
  title: 'Systems Lab',
  description: 'Lab brief',
  instructions: 'Submit a report',
  activity_type: 'Assignment',
  due_date: null,
  max_score: 100,
  status: 'Published',
  assigned_sections: [{ id: 2, section_name: 'Section A' }],
  assigned_instructor: 3,
  assigned_instructor_name: 'Rae Santos',
  assigned_student_count: 12,
  submitted_students_count: 4,
  attachments: [],
}

describe('Admin Activities', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('is read-only and displays activities without deadlines correctly', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/activities/') return Promise.resolve({ data: { count: 1, next: null, results: [activity] } })
      if (path === '/activities/1/') return Promise.resolve({ data: activity })
      if (path === '/sections/') return Promise.resolve({ data: [{ id: 2, section_name: 'Section A' }] })
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<MemoryRouter><Activities /></MemoryRouter>)

    expect(await screen.findByText('Systems Lab')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Create Activity/i })).toBeNull()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Systems Lab' }))[0])
    expect(await screen.findByRole('menuitem', { name: 'View' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Edit|Duplicate|Assign Sections|Close Activity|Archive|Delete/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))

    expect(await screen.findByRole('dialog', { name: 'Systems Lab' })).toBeTruthy()
    expect(screen.getByText('Activity Overview')).toBeTruthy()
    expect(screen.getByText('Description and Instructions')).toBeTruthy()
    expect(screen.getByText('Assigned Students and Submission Progress')).toBeTruthy()
    expect(screen.getByText('Attached Files')).toBeTruthy()
    expect(await screen.findAllByText('No deadline')).toHaveLength(2)
    expect(screen.getByText('Maximum score')).toBeTruthy()
    expect(screen.getAllByText('Rae Santos')).toHaveLength(2)
  })
})