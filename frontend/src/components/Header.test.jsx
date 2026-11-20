import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('Account profile avatar', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('loads the saved image for admins and updates it from profile changes', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 1, username: 'admin', role: 'admin' }))
    api.get.mockResolvedValue({ data: {
      id: 1,
      username: 'admin',
      role: 'admin',
      first_name: 'Admin',
      last_name: 'One',
      profile_image_url: 'https://storage.example/admin-v1.jpg',
      updated_at: '2026-11-20T08:00:00Z',
      nfc_uid: 'PRIVATE-ADMIN-UID',
    } })
    render(<MemoryRouter><Header /></MemoryRouter>)

    expect((await screen.findByRole('img', { name: 'admin profile picture' })).getAttribute('src')).toBe('https://storage.example/admin-v1.jpg')
    expect(localStorage.getItem('user')).not.toContain('PRIVATE-ADMIN-UID')
    window.dispatchEvent(new CustomEvent('taptrack-profile-updated', { detail: {
      profile_image_url: 'https://storage.example/admin-v2.jpg',
      updated_at: '2026-11-20T08:10:00Z',
    } }))
    await waitFor(() => expect(screen.getByRole('img', { name: 'admin profile picture' }).getAttribute('src')).toBe('https://storage.example/admin-v2.jpg'))
  })

  it('does not replace a newer photo event with an older profile response', async () => {
    let resolveProfileRequest
    localStorage.setItem('user', JSON.stringify({ id: 1, username: 'admin', role: 'admin' }))
    api.get.mockReturnValue(new Promise((resolve) => { resolveProfileRequest = resolve }))
    render(<MemoryRouter><Header /></MemoryRouter>)

    window.dispatchEvent(new CustomEvent('taptrack-profile-updated', { detail: {
      id: 1,
      username: 'admin',
      role: 'admin',
      profile_image_url: 'https://storage.example/admin-latest.jpg',
      updated_at: '2026-11-20T08:10:00Z',
    } }))
    resolveProfileRequest({ data: {
      id: 1,
      username: 'admin',
      role: 'admin',
      profile_image_url: 'https://storage.example/admin-stale.jpg',
      updated_at: '2026-11-20T08:00:00Z',
    } })

    await waitFor(() => expect(screen.getByRole('img', { name: 'admin profile picture' }).getAttribute('src')).toBe('https://storage.example/admin-latest.jpg'))
  })
})