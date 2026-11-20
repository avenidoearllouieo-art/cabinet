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

    fireEvent.click(screen.getByRole('button', { name: 'Instructor' }))
    expect(screen.getByRole('heading', { name: 'Instructor tasks' })).toBeTruthy()
    expect(screen.getByText(/Save as Draft/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Administrator' }))
    expect(screen.getByRole('heading', { name: 'Administrator tasks' })).toBeTruthy()
    expect(screen.getByText(/Review the import preview/)).toBeTruthy()
  }, 10000)

  it('describes the implemented architecture and leaves acknowledgments editable', () => {
    render(<MemoryRouter><AboutTapTrack /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'About TapTrack' })).toBeTruthy()
    expect(screen.getByText('React dashboard')).toBeTruthy()
    expect(screen.getByText('Django REST API')).toBeTruthy()
    expect(screen.getByText('Raspberry Pi NFC service')).toBeTruthy()
    expect(screen.getByText('ESP32 controller')).toBeTruthy()
    expect(screen.getByText('Django media and Tigris')).toBeTruthy()
    expect(screen.getByText('[Project Team Members]')).toBeTruthy()
    expect(screen.getByText('[Faculty Adviser]')).toBeTruthy()
    expect(screen.queryByText(/Version\s*\d/i)).toBeNull()
  })
})