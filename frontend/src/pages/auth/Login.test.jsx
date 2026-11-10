import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import api from '../../services/api.js'
import Login from './Login.jsx'

vi.mock('../../services/api.js', () => ({
  default: {
    post: vi.fn(),
    defaults: { headers: { common: {} } },
  },
}))

function CurrentPath() {
  const location = useLocation()
  return <output data-testid="current-path">{location.pathname}</output>
}

function renderLogin(administratorOnly = false) {
  return render(
    <MemoryRouter>
      <Login administratorOnly={administratorOnly} />
      <CurrentPath />
    </MemoryRouter>,
  )
}

describe('Login', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('shows matching user and administrator copy with text-only navigation links', () => {
    renderLogin()
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy()
    expect(screen.getByText('Sign in to access your TapTrack cabinet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Administrator Login →' }).getAttribute('href')).toBe('/admin/login')

    cleanup()
    renderLogin(true)
    expect(screen.getByRole('heading', { name: 'Administrator Portal' })).toBeTruthy()
    expect(screen.getByText('Sign in to manage the TapTrack system')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Log In as Administrator' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '← Return to User Login' }).getAttribute('href')).toBe('/')
  })

  it('reports missing credentials and toggles password visibility', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: 'Log In' }))
    expect(screen.getByRole('alert').textContent).toBe('Enter your username and password.')
    expect(api.post).not.toHaveBeenCalled()

    const passwordInput = screen.getByLabelText(/^Password/)
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(passwordInput.type).toBe('text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(passwordInput.type).toBe('password')
  })

  it('submits with Enter, blocks repeated attempts while loading, and hides server credential details', async () => {
    const user = userEvent.setup()
    let rejectLogin
    api.post.mockReturnValueOnce(new Promise((_, reject) => { rejectLogin = reject }))
    renderLogin()

    await user.type(screen.getByLabelText(/^Username/), 'student-one')
    await user.type(screen.getByLabelText(/^Password/), 'incorrect-password')
    await user.keyboard('{Enter}')

    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.post).toHaveBeenCalledWith('/auth/login/', {
      username: 'student-one',
      password: 'incorrect-password',
    })
    const submitButton = screen.getByRole('button', { name: 'Logging in...' })
    expect(submitButton.disabled).toBe(true)
    await user.click(submitButton)
    expect(api.post).toHaveBeenCalledTimes(1)

    rejectLogin({ response: { status: 401, data: { detail: 'internal authentication detail' } } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Invalid username or password. Please try again.'))
    expect(screen.queryByText('internal authentication detail')).toBeNull()
  })

  it('sends the administrator role requirement and redirects an administrator', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValueOnce({
      data: { access: 'access-token', refresh: 'refresh-token', user: { role: 'admin' } },
    })
    renderLogin(true)

    await user.type(screen.getByLabelText(/^Username/), 'system-admin')
    await user.type(screen.getByLabelText(/^Password/), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Log In as Administrator' }))

    await waitFor(() => expect(screen.getByTestId('current-path').textContent).toBe('/admin/dashboard'))
    expect(api.post).toHaveBeenCalledWith('/auth/login/', {
      username: 'system-admin',
      password: 'correct-password',
      expected_role: 'admin',
    })
    expect(localStorage.getItem('access')).toBe('access-token')
  })

  it.each([
    ['student', '/student/dashboard'],
    ['instructor', '/instructor/dashboard'],
  ])('redirects a %s account to its authorized page', async (role, destination) => {
    const user = userEvent.setup()
    api.post.mockResolvedValueOnce({
      data: { access: 'access-token', refresh: 'refresh-token', user: { role } },
    })
    renderLogin()

    await user.type(screen.getByLabelText(/^Username/), 'regular-user')
    await user.type(screen.getByLabelText(/^Password/), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Log In' }))

    await waitFor(() => expect(screen.getByTestId('current-path').textContent).toBe(destination))
    expect(localStorage.getItem('user')).toBe(JSON.stringify({ role }))
  })

  it('does not establish a session when the returned role is not allowed on the selected login page', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValueOnce({
      data: { access: 'access-token', refresh: 'refresh-token', user: { role: 'student' } },
    })
    renderLogin(true)

    await user.type(screen.getByLabelText(/^Username/), 'regular-user')
    await user.type(screen.getByLabelText(/^Password/), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Log In as Administrator' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This account is not an administrator account.')
    expect(screen.getByTestId('current-path').textContent).toBe('/')
    expect(localStorage.getItem('access')).toBeNull()
  })
})