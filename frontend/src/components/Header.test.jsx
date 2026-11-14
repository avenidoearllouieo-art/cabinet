import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Header from './Header.jsx'
import api from '../services/api.js'

vi.mock('../services/api.js', () => ({ default: { get: vi.fn() } }))
vi.mock('./NotificationDropdown', () => ({ default: () => <div aria-hidden="true" /> }))

describe('Instructor account menu', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('contains Profile and Logout but not Change Password', () => {
    localStorage.setItem('user', JSON.stringify({ id: 3, username: 'instructor', role: 'instructor' }))
    api.get.mockResolvedValue({ data: { id: 3, username: 'instructor', role: 'instructor' } })
    render(<MemoryRouter><Header /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'instructor account options' }))

    expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Change Password' })).toBeNull()
  })
})

describe('Student account menu', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('contains only Profile and Logout', () => {
    localStorage.setItem('user', JSON.stringify({ id: 8, username: 'student', role: 'student' }))
    api.get.mockResolvedValue({ data: { id: 8, username: 'student', role: 'student' } })
    render(<MemoryRouter><Header /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'student account options' }))

    expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'My Instructor' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change Password' })).toBeNull()
  })
})