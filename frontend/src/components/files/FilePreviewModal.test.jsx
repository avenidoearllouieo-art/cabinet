import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import api from '../../services/api.js'
import FilePreviewModal from './FilePreviewModal.jsx'

vi.mock('../../services/api.js', () => ({ default: { post: vi.fn(), delete: vi.fn().mockResolvedValue({ status: 204 }) } }))

const authorizedVideo = (url) => ({
  filename: 'defense.mp4',
  size: 1024,
  content_type: 'video/mp4',
  preview_type: 'video',
  preview_supported: true,
  content_url: `https://taptrack-files.t3.storage.dev/${url}?signature=private`,
  download_url: `https://taptrack-files.t3.storage.dev/${url}?download=private`,
})

describe('FilePreviewModal', () => {
  beforeEach(() => {
    api.delete.mockResolvedValue({ status: 204 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  it('reauthorizes a video preview once when its short-lived URL expires', async () => {
    api.post
      .mockResolvedValueOnce({ data: authorizedVideo('old-object') })
      .mockResolvedValueOnce({ data: authorizedVideo('refreshed-object') })
    render(<FilePreviewModal attachment={{ id: 12, filename: 'defense.mp4' }} kind="submission" onClose={vi.fn()} />)

    await waitFor(() => expect(document.querySelector('video')).toBeTruthy())
    const video = document.querySelector('video')
    expect(video.getAttribute('src')).toContain('old-object')
    fireEvent.error(video)

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('refreshed-object'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renews authorization when downloading from an already-open preview', async () => {
    api.post
      .mockResolvedValueOnce({ data: authorizedVideo('initial-object') })
      .mockResolvedValueOnce({ data: authorizedVideo('fresh-download') })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<FilePreviewModal attachment={{ id: 14, filename: 'defense.mp4' }} kind="submission" onClose={vi.fn()} />)

    await waitFor(() => expect(document.querySelector('video')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(api.post.mock.calls[1][0]).toBe('/file-previews/submission/14/authorize/')
  })

  it('never displays an HTML server error body in the preview modal', async () => {
    api.post.mockRejectedValue({
      name: 'AxiosError',
      response: {
        status: 500,
        headers: { 'content-type': 'text/html' },
        data: '<!doctype html><title>Server Error (500)</title>',
      },
    })
    render(<FilePreviewModal attachment={{ id: 15, filename: 'missing.pdf' }} kind="activity" onClose={vi.fn()} />)

    expect((await screen.findByRole('alert')).textContent).toContain('The file could not be opened.')
    expect(document.body.textContent).not.toContain('<!doctype html>')
  })
})
