import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  created_at: '2026-01-02T12:00:00Z',
  nfc_registered: false,
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
    const lastPage = [{ ...directoryUser(21, 'student', false), profile_image_url: 'https://storage.example/student-21.jpg' }]
    api.get.mockImplementation((_url, { params }) => Promise.resolve({
      data: params.page === 1
        ? { count: 21, next: 'http://localhost/api/users/?page=2', results: firstPage }
        : { count: 21, next: null, results: lastPage },
    }))

    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', username: 'admin.1' }))
    render(<MemoryRouter><Users /></MemoryRouter>)

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText('AR').length).toBeGreaterThan(0)
    expect(await screen.findByText('Page 1 of 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next users page' }))
    expect(await screen.findByText('Student Record 21')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Student Record 21 profile picture' }).getAttribute('src')).toBe('https://storage.example/student-21.jpg')

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

  it('renders and collapses shared details for student, instructor, and administrator rows', async () => {
    const users = [
      {
        ...directoryUser(42, 'student'),
        student_id: 'STU-42',
        section_name: 'Section Blue',
        nfc_registered: true,
        nfc_uid: 'PRIVATE-STUDENT-UID',
      },
      {
        ...directoryUser(43, 'instructor'),
        instructor_id: 'INS-43',
        assigned_sections: [{ section_id: 7, section_name: 'Section Green' }],
      },
      directoryUser(44, 'admin'),
    ]
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    api.get.mockResolvedValue({ data: { count: users.length, next: null, results: users } })
    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', username: 'admin.1' }))
    render(<MemoryRouter><Users /></MemoryRouter>)

    await screen.findByText('Student Record 42')
    const expectedDetails = [
      ['Student ID / User ID', 'STU-42', 'Section Blue', 'Registered'],
      ['Instructor ID / User ID', 'INS-43', 'Section Green', 'Not registered'],
      ['User ID', '44', 'Not assigned', 'Not registered'],
    ]

    for (const [index, [identifierLabel, identifier, section, nfcStatus]] of expectedDetails.entries()) {
      const expandButton = screen.getByRole('button', { name: `Expand row ${index + 1}` })
      fireEvent.click(expandButton)
      const expandedRow = expandButton.closest('tr').nextElementSibling

      expect(within(expandedRow).getByText('Full name')).toBeTruthy()
      expect(within(expandedRow).getByText(identifierLabel)).toBeTruthy()
      expect(within(expandedRow).getByText(identifier)).toBeTruthy()
      expect(within(expandedRow).getByText(section)).toBeTruthy()
      expect(within(expandedRow).getByText(nfcStatus)).toBeTruthy()
      expect(within(expandedRow).getByText('Date joined')).toBeTruthy()
      expect(within(expandedRow).queryByText('PRIVATE-STUDENT-UID')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: `Collapse row ${index + 1}` }))
      expect(screen.queryByText(identifierLabel)).toBeNull()
    }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  it('expands only the selected mobile user card at common phone widths', async () => {
    const user = directoryUser(42, 'student')
    const originalWidth = window.innerWidth
    api.get.mockResolvedValue({ data: { count: 1, next: null, results: [{ ...user, student_id: 'STU-42', section_name: 'Section Blue', nfc_registered: true, nfc_uid: 'PRIVATE-STUDENT-UID' }] } })
    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', username: 'admin.1' }))

    for (const width of [375, 360, 390, 430]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      const view = render(<MemoryRouter><Users /></MemoryRouter>)
      const article = (await screen.findByText('Student Record 42')).closest('article')
      const expand = within(article).getByRole('button', { name: 'More details' })

      fireEvent.click(expand)
      expect(expand.getAttribute('aria-expanded')).toBe('true')
      expect(within(article).getByText('Full name')).toBeTruthy()
      expect(within(article).getAllByText('STU-42')).toHaveLength(2)
      expect(within(article).getByText('Section Blue')).toBeTruthy()
      expect(within(article).getByText('Email address')).toBeTruthy()
      expect(within(article).getByText('Account role')).toBeTruthy()
      expect(within(article).getByText('Account status')).toBeTruthy()
      expect(within(article).getByText('NFC registration')).toBeTruthy()
      expect(within(article).getAllByText('Registered')).toHaveLength(2)
      expect(within(article).queryByText('PRIVATE-STUDENT-UID')).toBeNull()
      expect(within(article).getByText('Date joined')).toBeTruthy()
      expect(within(article).getByRole('button', { name: 'View Profile' })).toBeTruthy()
      expect(within(article).getByRole('button', { name: 'Less details' })).toBeTruthy()

      fireEvent.click(within(article).getByRole('button', { name: 'Less details' }))
      expect(within(article).getByRole('button', { name: 'More details' }).getAttribute('aria-expanded')).toBe('false')
      view.unmount()
      cleanup()
      api.get.mockClear()
    }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })
})