import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../../services/api.js'
import AccessLogPhotoPanel from './AccessLogPhotoPanel.jsx'

vi.mock('../../services/api.js', () => ({
  default: {
    defaults: { baseURL: '/api' },
    get: vi.fn(),
  },
}))

const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })

function successMetadata(eventId) {
  return {
    event_id: eventId,
    capture_status: 'success',
    captured_at: '2026-10-20T10:00:00Z',
    image_available: true,
    image_endpoint: `/api/access-logs/${eventId}/photo/image/`,
  }
}

describe('AccessLogPhotoPanel', () => {
  beforeEach(() => {
    api.get.mockReset()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:protected-access-event-photo'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a loading state while the protected event photo is retrieved', async () => {
    let resolveMetadata
    api.get.mockReturnValueOnce(new Promise((resolve) => { resolveMetadata = resolve }))
    render(<AccessLogPhotoPanel eventId={41} allowImage />)

    expect(screen.getByRole('status').textContent).toContain('Loading photo')
    resolveMetadata({ data: { event_id: 41, capture_status: 'failed', image_available: false } })
    expect(await screen.findByText('Photo unavailable')).toBeTruthy()
  })

  it('refreshes pending status and fetches the protected image for the matching event', async () => {
    api.get
      .mockResolvedValueOnce({ data: { event_id: 52, capture_status: 'pending', image_available: false } })
      .mockResolvedValueOnce({ data: successMetadata(52) })
      .mockResolvedValueOnce({ data: jpeg, headers: { 'content-type': 'image/jpeg' } })

    render(<AccessLogPhotoPanel eventId={52} allowImage />)

    const thumbnail = await screen.findByRole('img', { name: 'Access event 52 photo thumbnail' }, { timeout: 4000 })
    expect(thumbnail.getAttribute('src')).toBe('blob:protected-access-event-photo')
    expect(api.get).toHaveBeenNthCalledWith(1, '/access-logs/52/photo/', { params: { refresh: 0 } })
    expect(api.get).toHaveBeenNthCalledWith(2, '/access-logs/52/photo/', { params: { refresh: 1 } })
    expect(api.get).toHaveBeenNthCalledWith(3, '/access-logs/52/photo/image/', {
      responseType: 'blob',
      headers: { Accept: 'image/jpeg' },
      params: { refresh: 1 },
    })
  })

  it('rejects mismatched event metadata and reports the photo unavailable', async () => {
    api.get.mockResolvedValueOnce({ data: successMetadata(99) })
    render(<AccessLogPhotoPanel eventId={61} allowImage />)

    expect(await screen.findByText('Photo unavailable')).toBeTruthy()
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledWith('/access-logs/61/photo/', { params: { refresh: 0 } })
  })

  it('marks a missing photo record unavailable without retrying', async () => {
    api.get.mockResolvedValueOnce({ data: { event_id: 64, capture_status: null, image_available: false } })
    render(<AccessLogPhotoPanel eventId={64} allowImage />)

    expect(await screen.findByText('Photo unavailable')).toBeTruthy()
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('opens the zoom viewer and supports zoom, full size, fit, Escape, and backdrop close', async () => {
    const user = userEvent.setup()
    api.get
      .mockResolvedValueOnce({ data: successMetadata(72) })
      .mockResolvedValueOnce({ data: jpeg, headers: { 'content-type': 'image/jpeg' } })
    render(<AccessLogPhotoPanel eventId={72} allowImage />)

    await user.click(await screen.findByRole('button', { name: 'Open photo for access event 72' }))
    expect(screen.getByRole('dialog', { name: 'Access event photo viewer' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Full-size captured access event' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('125%')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'View at full size' }))
    expect(screen.getByRole('button', { name: 'View at full size' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('100%')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Fit to screen' }))
    expect(screen.getByText('100%')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Access event photo viewer' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Open photo for access event 72' }))
    fireEvent.click(screen.getByRole('presentation'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Access event photo viewer' })).toBeNull())
  })

  it('shows unavailable when the protected image endpoint fails', async () => {
    api.get
      .mockResolvedValueOnce({ data: successMetadata(83) })
      .mockRejectedValueOnce({ response: { status: 404 } })
    render(<AccessLogPhotoPanel eventId={83} allowImage />)

    expect(await screen.findByText('Photo unavailable')).toBeTruthy()
    expect(api.get).toHaveBeenNthCalledWith(2, '/access-logs/83/photo/image/', expect.objectContaining({ responseType: 'blob' }))
  })
})