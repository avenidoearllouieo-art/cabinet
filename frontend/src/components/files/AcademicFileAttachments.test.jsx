import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import api from '../../services/api.js'
import AcademicFileAttachments from './AcademicFileAttachments.jsx'

vi.mock('../../services/api.js', () => ({
  default: {
    defaults: { baseURL: '/api' },
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

const pdfAuthorization = {
  data: {
    filename: 'brief.pdf',
    size: 1024,
    content_type: 'application/pdf',
    preview_type: 'pdf',
    preview_supported: true,
    content_url: '/api/file-previews/activity/7/content/',
    download_url: '/api/file-previews/activity/7/content/?download=1',
  },
}

describe('AcademicFileAttachments', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  it('opens a protected PDF in a modal and closes it with Escape', async () => {
    api.post.mockResolvedValue(pdfAuthorization)
    api.delete.mockResolvedValue({ status: 204 })
    render(<AcademicFileAttachments attachments={[{ id: 7, filename: 'brief.pdf', size: 1024 }]} kind="activity" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }))

    const dialog = await screen.findByRole('dialog', { name: 'brief.pdf' })
    expect(api.post).toHaveBeenCalledWith('/file-previews/activity/7/authorize/', {}, { withCredentials: true, timeout: 30_000 })
    expect(dialog.querySelector('iframe').getAttribute('src')).toContain('/api/file-previews/activity/7/content/')
    expect(screen.getByRole('button', { name: 'Close file preview' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'brief.pdf' })).toBeNull())
  })

  it('downloads through the authorized endpoint without opening the preview modal', async () => {
    api.post.mockResolvedValue(pdfAuthorization)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<AcademicFileAttachments attachments={[{ id: 7, filename: 'brief.pdf' }]} kind="activity" />)

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the unsupported type state and retains a download action', async () => {
    api.post.mockResolvedValue({ data: { filename: 'slides.pptx', preview_supported: false, preview_type: 'unsupported', download_url: '/download' } })
    api.delete.mockResolvedValue({ status: 204 })
    render(<AcademicFileAttachments attachments={[{ id: 8, filename: 'slides.pptx' }]} kind="activity" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }))

    expect(await screen.findByText('Preview unavailable for this file type.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download file' })).toBeTruthy()
  })

  it('renders image previews in the modal without changing their aspect ratio', async () => {
    api.post.mockResolvedValue({ data: {
      filename: 'photo.png',
      preview_supported: true,
      preview_type: 'image',
      content_url: '/api/file-previews/activity/10/content/',
      download_url: '/api/file-previews/activity/10/content/?download=1',
    } })
    api.delete.mockResolvedValue({ status: 204 })
    render(<AcademicFileAttachments attachments={[{ id: 10, filename: 'photo.png', content_type: 'image/png' }]} kind="activity" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }))

    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })
    expect(dialog.querySelector('img').getAttribute('alt')).toBe('photo.png')
    expect(dialog.querySelector('img').className).toContain('object-contain')
  })

  it('renders video controls without autoplay', async () => {
    api.post.mockResolvedValue({ data: {
      filename: 'capture.mp4',
      preview_supported: true,
      preview_type: 'video',
      content_url: '/api/file-previews/activity/11/content/',
      download_url: '/api/file-previews/activity/11/content/?download=1',
    } })
    api.delete.mockResolvedValue({ status: 204 })
    render(<AcademicFileAttachments attachments={[{ id: 11, filename: 'capture.mp4', content_type: 'video/mp4' }]} kind="activity" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }))

    const dialog = await screen.findByRole('dialog', { name: 'capture.mp4' })
    const video = dialog.querySelector('video')
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.hasAttribute('autoplay')).toBe(false)
  })

  it('reports a missing file instead of opening a broken browser page', async () => {
    api.post.mockRejectedValue({ response: { status: 404 } })
    api.delete.mockResolvedValue({ status: 204 })
    render(<AcademicFileAttachments attachments={[{ id: 9, filename: 'missing.mp4' }]} kind="activity" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }))

    expect(await screen.findByText('The file could not be opened. Check your access or ask the owner to upload it again.')).toBeTruthy()
  })
})