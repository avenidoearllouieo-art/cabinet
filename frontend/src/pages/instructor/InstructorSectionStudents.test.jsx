import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import api from '../../services/api.js'
import InstructorSectionStudents from './InstructorSectionStudents.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('InstructorSectionStudents', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('lists section students without exposing or searching NFC UIDs', async () => {
    api.get.mockImplementation((path, { params } = {}) => {
      if (path === '/sections/3/') return Promise.resolve({ data: { id: 3, section_name: 'Section A', year_level: '2nd Year', academic_year: '2026-2027' } })
      if (path === '/users/' && String(params?.section) === '3' && params?.role === 'student') return Promise.resolve({ data: { results: [{
        id: 8,
        first_name: 'Mika',
        last_name: 'Reyes',
        student_id: 'ST-8',
        email: 'mika@example.edu',
        section_name: 'Section A',
        is_active: true,
        nfc_uid: 'STUDENT-UID-PRIVATE',
      }] } })
      throw new Error(`Unexpected GET ${path}`)
    })

    render(
      <MemoryRouter initialEntries={['/instructor/sections/3/students']}>
        <Routes><Route path="/instructor/sections/:sectionId/students" element={<InstructorSectionStudents />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Mika Reyes')).toBeTruthy()
    expect(screen.getByText('ST-8')).toBeTruthy()
    expect(screen.queryByText('NFC UID')).toBeNull()
    expect(screen.queryByText('STUDENT-UID-PRIVATE')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit User' })).toBeNull()
    expect(screen.queryByText('Action')).toBeNull()
    expect(api.get).toHaveBeenCalledWith('/users/', { params: { section: '3', role: 'student', page: 1 } })
    expect(screen.getByRole('searchbox', { name: 'Search students' }).getAttribute('placeholder')).toBe('Search student ID, name, or email')
  })
})