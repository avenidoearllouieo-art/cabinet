import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UserGuide from './UserGuide.jsx'
import AboutTapTrack from './AboutTapTrack.jsx'

describe('TapTrack information pages', () => {
  afterEach(cleanup)

  it('shows role-specific guide instructions', () => {
    render(<MemoryRouter><UserGuide /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Student tasks' })).toBeTruthy()
    expect(screen.getByText(/registered NFC card/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Administrator' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to Login' }).getAttribute('href')).toBe('/')

    fireEvent.click(screen.getByRole('button', { name: 'Instructor' }))
    expect(screen.getByRole('heading', { name: 'Instructor tasks' })).toBeTruthy()
    expect(screen.getByText(/Save as Draft/)).toBeTruthy()

  }, 10000)

  it('describes the implemented architecture and leaves acknowledgments editable', () => {
    render(<MemoryRouter><AboutTapTrack /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'About TapTrack' })).toBeTruthy()
    expect(screen.getByText('React dashboard')).toBeTruthy()
    expect(screen.getByText('Django REST API')).toBeTruthy()
    expect(screen.getByText('Raspberry Pi NFC service')).toBeTruthy()
    expect(screen.getByText('ESP32 controller')).toBeTruthy()
    expect(screen.queryByText('Django media and Tigris')).toBeNull()
    expect(screen.getByText('Ramiro, Christian Joseph F.')).toBeTruthy()
    expect(screen.getByText('Engr. Jay Noel Rojo')).toBeTruthy()
    expect(screen.getByText(/4th Floor Hallway, near the College of Information Technology and Computing/)).toBeTruthy()
    expect(screen.getByText('College of Information Technology and Computing', { exact: true })).toBeTruthy()
    expect(screen.getByText(/automatically attempts to capture a photo/)).toBeTruthy()
    expect(screen.queryByText(/Version\s*\d/i)).toBeNull()
  })
})