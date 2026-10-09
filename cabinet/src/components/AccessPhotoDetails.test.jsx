import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccessPhotoDetails from './AccessPhotoDetails.jsx'

const capturedPhoto = {
  eventId: 123,
  state: 'captured',
  label: 'Captured',
  capturedAt: '2026-10-09T14:45:00Z',
  diagnosticError: null,
  imageBlob: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
}

describe('AccessPhotoDetails', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:captured-access-photo'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0)
    window.cancelAnimationFrame = (frameId) => window.clearTimeout(frameId)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows Pending status and the pending placeholder', () => {
    render(<AccessPhotoDetails photo={{ state: 'pending', label: 'Pending', imageBlob: null }} />)

    expect(screen.getByText('Pending')).toBeTruthy()
    expect(screen.getByText('Photo capture is pending.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /preview/i })).toBeNull()
  })

  it('shows failed and missing photos as Unavailable', () => {
    const { rerender } = render(<AccessPhotoDetails photo={{ state: 'unavailable', label: 'Unavailable', imageBlob: null }} />)
    expect(screen.getByText('Unavailable')).toBeTruthy()
    expect(screen.getByText('No photo is available for this scan.')).toBeTruthy()

    rerender(<AccessPhotoDetails photo={{ state: 'unavailable', label: 'Unavailable', imageBlob: null, diagnosticError: 'Image is unavailable.' }} />)
    expect(screen.getByText('Image is unavailable.')).toBeTruthy()
  })

  it('renders a captured thumbnail and opens/closes the larger preview', async () => {
    const user = userEvent.setup()
    render(<AccessPhotoDetails photo={capturedPhoto} />)

    const thumbnail = await screen.findByRole('img', { name: 'Captured access event' })
    expect(thumbnail.getAttribute('src')).toBe('blob:captured-access-photo')
    expect(screen.getByText('Captured')).toBeTruthy()
    expect(screen.getByText(/Oct 9, 2026/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Open captured photo preview' }))
    expect(screen.getByRole('dialog', { name: 'Captured access photo' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Full-size captured access event' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Close photo preview' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the preview with Escape and revokes the protected blob URL on unmount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AccessPhotoDetails photo={capturedPhoto} />)
    await screen.findByRole('img', { name: 'Captured access event' })
    await user.click(screen.getByRole('button', { name: 'Open captured photo preview' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:captured-access-photo')
  })

  it('replaces a thumbnail that fails to decode with an unavailable preview message', async () => {
    render(<AccessPhotoDetails photo={capturedPhoto} />)
    const thumbnail = await screen.findByRole('img', { name: 'Captured access event' })
    fireEvent.error(thumbnail)

    await waitFor(() => expect(screen.getByText('Photo preview is unavailable.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Open captured photo preview' })).toBeNull()
  })
})