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
    vi.unstubAllGlobals()
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

  it('opens the shared Add User form directly from the button', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url === '/sections/' ? [] : [] }))

    render(<MemoryRouter><Users /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: 'Add user' }))

    expect(await screen.findByText('Add New User')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Add Student|Add Instructor|Add Administrator/ })).toBeNull()
  })

  it('downloads a real Excel workbook for the selected user IDs', async () => {
    const user = directoryUser(42, 'student')
    api.get.mockResolvedValue({ data: { count: 1, next: null, results: [user] } })
    api.post.mockResolvedValue({ data: new Blob(['xlsx']) })
    const nativeUrl = globalThis.URL
    vi.stubGlobal('URL', Object.assign(class extends nativeUrl {}, {
      createObjectURL: vi.fn(() => 'blob:users-report'),
      revokeObjectURL: vi.fn(),
    }))
    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', username: 'admin.1' }))
    render(<MemoryRouter><Users /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select student.42' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Actions (1)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export Excel' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/users/export-excel/',
      { ids: [42] },
      { responseType: 'blob' },
    ))
  })
})