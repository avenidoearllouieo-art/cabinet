import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import Users from './Users.jsx'

vi.mock('../../services/api.js', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const directoryUser = (id, role, isActive = true) => ({
  id,
  username: `${role}.${id}`,
  first_name: role === 'student' ? 'Student' : role === 'instructor' ? 'Instructor' : 'Admin',
  last_name: `Record ${id}`,
  email: `${role}.${id}@example.edu`,
  role,
  is_active: isActive,
  nfc_uid: null,
})

describe('Users directory', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('loads all API pages and composes role, status, and search filters', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => directoryUser(index + 1, index % 2 ? 'student' : 'instructor', index !== 2))
    firstPage[0] = directoryUser(1, 'admin', true)
    const lastPage = [directoryUser(21, 'student', false)]
    api.get.mockImplementation((_url, { params }) => Promise.resolve({
      data: params.page === 1
        ? { count: 21, next: 'http://localhost/api/users/?page=2', results: firstPage }
        : { count: 21, next: null, results: lastPage },
    }))

    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', username: 'admin.1' }))
    render(<MemoryRouter><Users /></MemoryRouter>)

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next users page' }))
    expect(await screen.findByText('Student Record 21')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Students' }))
    expect(screen.getByText('Page 1 of 1')).toBeTruthy()

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'inactive' } })
    const search = screen.getByRole('searchbox', { name: 'Search users' })
    fireEvent.change(search, { target: { value: 'student.21' } })
    expect(screen.getByText('Student Record 21')).toBeTruthy()
    expect(screen.queryByText('Student Record 3')).toBeNull()
  })
})