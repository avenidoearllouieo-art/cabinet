import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import UserAvatar from './UserAvatar.jsx'

describe('UserAvatar', () => {
  afterEach(cleanup)

  it('uses the saved image, falls back on load failure, and retries after the profile version changes', () => {
    const user = {
      first_name: 'Stu',
      last_name: 'Dent',
      profile_image_url: 'https://storage.example/profile.jpg',
      updated_at: '2026-11-20T08:00:00Z',
    }
    const { rerender } = render(<UserAvatar user={user} alt="Student profile picture" />)

    const image = screen.getByRole('img', { name: 'Student profile picture' })
    expect(image.getAttribute('src')).toBe(user.profile_image_url)
    fireEvent.error(image)
    expect(screen.queryByRole('img', { name: 'Student profile picture' })).toBeNull()
    expect(screen.getByText('SD')).toBeTruthy()

    rerender(<UserAvatar user={{ ...user, updated_at: '2026-11-20T08:10:00Z' }} alt="Student profile picture" />)
    expect(screen.getByRole('img', { name: 'Student profile picture' }).getAttribute('src')).toBe(user.profile_image_url)
    rerender(<UserAvatar user={{ ...user, profile_image_url: null, updated_at: '2026-11-20T08:20:00Z' }} alt="Student profile picture" />)
    expect(screen.queryByRole('img', { name: 'Student profile picture' })).toBeNull()
    expect(screen.getByText('SD')).toBeTruthy()
  })

  it('shows initials when there is no usable picture URL', () => {
    render(<UserAvatar user={{ first_name: 'Stu', last_name: 'Dent' }} alt="Student profile picture" />)

    expect(screen.queryByRole('img', { name: 'Student profile picture' })).toBeNull()
    expect(screen.getByText('SD')).toBeTruthy()
  })
})