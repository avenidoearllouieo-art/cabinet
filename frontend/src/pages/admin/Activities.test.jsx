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

  it('combines section, status, search, and sort across all pages and resets filters', async () => {
    const records = [
      { ...activity, id: 1, title: 'Alpha match', status: 'Published', created_at: '2026-01-02T00:00:00Z' },
      { ...activity, id: 2, title: 'Draft match', status: 'Draft', created_at: '2026-01-01T00:00:00Z' },
      { ...activity, id: 3, title: 'Beta match', status: 'Published', assigned_sections: [{ id: 3, section_name: 'Section B' }], created_at: '2026-01-03T00:00:00Z' },
    ]
    api.get.mockImplementation((path, config = {}) => {
      if (path === '/activities/') {
        return Promise.resolve(config.params?.page === 2
          ? { data: { count: 3, next: null, results: [records[2]] } }
          : { data: { count: 3, next: 'http://localhost/api/activities/?page=2', results: records.slice(0, 2) } })
      }
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<MemoryRouter><Activities /></MemoryRouter>)

    const search = await screen.findByRole('searchbox', { name: 'Search activities' })
    const status = screen.getByRole('combobox', { name: 'Filter activity status' })
    const section = screen.getByRole('combobox', { name: 'Filter assigned section' })
    const sort = screen.getByRole('combobox', { name: 'Sort activities' })

    fireEvent.change(search, { target: { value: 'match' } })
    fireEvent.change(status, { target: { value: 'Published' } })
    fireEvent.change(section, { target: { value: 'Section A' } })
    fireEvent.change(sort, { target: { value: 'oldest' } })

    expect(await screen.findByText('Alpha match')).toBeTruthy()
    expect(screen.queryByText('Draft match')).toBeNull()
    expect(screen.queryByText('Beta match')).toBeNull()
    expect(screen.getByText('1 result')).toBeTruthy()

    fireEvent.change(section, { target: { value: 'Section B' } })
    expect(await screen.findByText('Beta match')).toBeTruthy()
    expect(screen.queryByText('Alpha match')).toBeNull()
    expect(status.value).toBe('Published')
    expect(sort.value).toBe('oldest')

    fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }))
    expect(await screen.findByText('Draft match')).toBeTruthy()
    expect(status.value).toBe('')
    expect(section.value).toBe('')
    expect(search.value).toBe('')
    expect(sort.value).toBe('oldest')
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
    expect(screen.queryByRole('combobox', { name: 'Filter activity type' })).toBeNull()
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