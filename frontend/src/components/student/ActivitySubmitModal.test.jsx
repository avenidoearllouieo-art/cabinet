import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../../services/api.js'
import { uploadTigrisVideo } from '../files/tigrisMultipartUpload.js'
import ActivitySubmitModal from './ActivitySubmitModal.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))
vi.mock('../files/tigrisMultipartUpload.js', () => ({ uploadTigrisVideo: vi.fn() }))

describe('ActivitySubmitModal', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('submits once after a successful file upload when the button is clicked repeatedly', async () => {
    api.get.mockResolvedValue({ data: { results: [] } })
    api.post.mockImplementation((path) => {
      if (path === '/student/submissions/upload') {
        return Promise.resolve({ data: { uploads: [{ id: 22, name: 'report.pdf', size: 6 }] } })
      }
      if (path === '/submissions/') return Promise.resolve({ data: {
        id: 15,
        files: [{ id: 31, name: 'report.pdf', size: 6, content_type: 'application/pdf' }],
        updated_at: '2026-11-20T10:00:00Z',
      } })
      throw new Error(`Unexpected POST ${path}`)
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ActivitySubmitModal activity={{ id: 5, title: 'Systems Lab' }} isOpen onClose={vi.fn()} onSuccess={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Files' }).disabled).toBe(false))
    const file = new File(['report'], 'report.pdf', { type: 'application/pdf' })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } })
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/student/submissions/upload', expect.any(FormData), expect.any(Object)))
    expect(api.post.mock.calls.filter(([path]) => path === '/submissions/')).toHaveLength(0)
    expect(await screen.findByText('report.pdf')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit Activity' }).disabled).toBe(false))
    const submitButton = screen.getByRole('button', { name: 'Submit Activity' })
    fireEvent.click(submitButton)
    fireEvent.click(submitButton)

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.post.mock.calls.filter(([path]) => path === '/submissions/')).toHaveLength(1))
    expect(api.post.mock.calls.find(([path]) => path === '/submissions/')[1].get('temp_upload_ids')).toBe('22')
    expect(await screen.findByRole('button', { name: 'Update Submission' })).toBeTruthy()
  })

  it('does not allow submission to a closed activity', async () => {
    api.get.mockResolvedValue({ data: { results: [] } })
    render(<ActivitySubmitModal activity={{ id: 6, title: 'Closed lab', status: 'Closed' }} isOpen onClose={vi.fn()} />)

    const closedButton = await screen.findByRole('button', { name: 'Submission Closed' })
    expect(closedButton.disabled).toBe(true)
  })

  it('rejects a video over the configured 5 GB storage-backed limit', async () => {
    api.get.mockResolvedValue({ data: { results: [] } })
    render(<ActivitySubmitModal activity={{ id: 8, title: 'Video assignment' }} isOpen onClose={vi.fn()} />)

    await screen.findByRole('button', { name: 'Choose Files' })
    const oversized = new File(['video'], 'large.mp4', { type: 'video/mp4' })
    Object.defineProperty(oversized, 'size', { value: 5 * 1024 ** 3 + 1 })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [oversized] } })

    expect(await screen.findByText(/large\.mp4: Video files must be 5 GB or smaller/)).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('sends videos over 500 MB directly to Tigris and submits only the verified upload ID', async () => {
    api.get.mockResolvedValue({ data: { results: [] } })
    api.post.mockResolvedValue({ data: {
      id: 15,
      files: [{ id: 32, name: 'defense.mp4', size: 600 * 1024 * 1024, content_type: 'video/mp4' }],
      updated_at: '2026-11-20T10:00:00Z',
    } })
    uploadTigrisVideo.mockResolvedValue({
      id: 22,
      temp_upload_id: 22,
      tempUploadId: 22,
      name: 'defense.mp4',
      size: 600 * 1024 * 1024,
      source: 'temp',
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ActivitySubmitModal activity={{ id: 13, title: 'Video assignment' }} isOpen onClose={vi.fn()} />)

    await screen.findByRole('button', { name: 'Choose Files' })
    const video = new File(['video'], 'defense.mp4', { type: 'video/mp4' })
    Object.defineProperty(video, 'size', { value: 600 * 1024 * 1024 })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [video] } })

    await waitFor(() => expect(uploadTigrisVideo).toHaveBeenCalledWith(video, 13, expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) })))
    expect(await screen.findByText('defense.mp4')).toBeTruthy()
    expect(api.post).not.toHaveBeenCalledWith('/student/submissions/upload', expect.anything(), expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Submit Activity' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledOnce())
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/submissions/', expect.any(FormData), { timeout: 60_000 }))
    const submission = api.post.mock.calls.find(([path]) => path === '/submissions/')[1]
    expect(submission.get('temp_upload_ids')).toBe('22')
  })

  it('stages a small video before explicit submission', async () => {
    api.get.mockResolvedValue({ data: { results: [] } })
    api.post.mockImplementation((path) => {
      if (path === '/student/submissions/upload') {
        return Promise.resolve({ data: { uploads: [{ id: 33, name: 'short-demo.mp4', size: 12, content_type: 'video/mp4' }] } })
      }
      if (path === '/submissions/') {
        return Promise.resolve({ data: { id: 55, files: [{ id: 44, name: 'short-demo.mp4', size: 12, content_type: 'video/mp4' }] } })
      }
      throw new Error(`Unexpected POST ${path}`)
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ActivitySubmitModal activity={{ id: 18, title: 'Video assignment' }} isOpen onClose={vi.fn()} />)

    await screen.findByRole('button', { name: 'Choose Files' })
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [new File(['video bytes'], 'short-demo.mp4', { type: 'video/mp4' })] },
    })

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/student/submissions/upload', expect.any(FormData), expect.any(Object)))
    expect(uploadTigrisVideo).not.toHaveBeenCalled()
    expect(api.post.mock.calls.filter(([path]) => path === '/submissions/')).toHaveLength(0)
    fireEvent.click(await screen.findByRole('button', { name: 'Submit Activity' }))

    await waitFor(() => expect(api.post.mock.calls.filter(([path]) => path === '/submissions/')).toHaveLength(1))
    expect(api.post.mock.calls.find(([path]) => path === '/submissions/')[1].get('temp_upload_ids')).toBe('33')
  })

  it('hides HTML 500 pages and restores Update after upload and save failures', async () => {
    api.get.mockResolvedValue({ data: { results: [{
      id: 44,
      submitted_at: '2026-11-18T10:00:00Z',
      updated_at: '2026-11-18T10:00:00Z',
      files: [{ id: 12, name: 'existing.png', size: 6, content_type: 'image/png' }],
    }] } })
    const htmlFailure = {
      name: 'AxiosError',
      response: {
        status: 500,
        headers: { 'content-type': 'text/html' },
        data: '<!doctype html><title>Server Error (500)</title>',
      },
    }
    api.post.mockRejectedValue(htmlFailure)
    api.patch.mockRejectedValue(htmlFailure)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ActivitySubmitModal activity={{ id: 19, title: 'Image assignment' }} isOpen onClose={vi.fn()} />)

    const updateButton = await screen.findByRole('button', { name: 'Update Submission' })
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [new File(['new image'], 'new.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText(/Upload failed\. Please try again\./)).toBeTruthy()
    expect(document.body.textContent).not.toContain('<!doctype html>')
    expect(screen.getByText('existing.png')).toBeTruthy()
    expect(updateButton.disabled).toBe(false)

    fireEvent.click(updateButton)
    expect(await screen.findByText(/Unable to update submission\. Please try again\./)).toBeTruthy()
    expect(document.body.textContent).not.toContain('<!doctype html>')
    expect(screen.getByText('existing.png')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update Submission' }).disabled).toBe(false)
    expect(api.patch).toHaveBeenCalledTimes(1)
  })

  it('blocks new submission creation when loading the existing submission fails', async () => {
    api.get.mockRejectedValue({
      name: 'AxiosError',
      response: {
        status: 500,
        headers: { 'content-type': 'text/html' },
        data: '<!doctype html><title>Server Error (500)</title>',
      },
    })
    render(<ActivitySubmitModal activity={{ id: 20, title: 'Video assignment' }} isOpen onClose={vi.fn()} />)

    expect(await screen.findByText(/Saved submission details could not be loaded/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('<!doctype html>')
    expect(screen.getByRole('button', { name: 'Submit Activity' }).disabled).toBe(true)
    expect(api.post).not.toHaveBeenCalled()
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('rejects a sixth file before starting an upload', async () => {
    api.get.mockResolvedValue({ data: { results: [] } })
    render(<ActivitySubmitModal activity={{ id: 9, title: 'Image assignment' }} isOpen onClose={vi.fn()} />)

    await screen.findByRole('button', { name: 'Choose Files' })
    const files = Array.from({ length: 6 }, (_, index) => new File(['image'], `photo-${index}.png`, { type: 'image/png' }))
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files } })

    expect(await screen.findByText(/A submission can contain at most 5 files/)).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('sends removed saved attachment IDs with replacement draft uploads', async () => {
    api.get.mockResolvedValue({
      data: {
        results: [{
          id: 44,
          files: [{ id: 12, name: 'existing.png', size: 6, content_type: 'image/png' }],
        }],
      },
    })
    api.post.mockResolvedValue({ data: { uploads: [{ id: 23, name: 'replacement.png', size: 11 }] } })
    render(<ActivitySubmitModal activity={{ id: 11, title: 'Image assignment' }} isOpen onClose={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Remove existing.png' }))
    const replacement = new File(['replacement'], 'replacement.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [replacement] } })

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/student/submissions/upload', expect.any(FormData), expect.any(Object)))
    const uploadForm = api.post.mock.calls.find(([path]) => path === '/student/submissions/upload')[1]
    expect(uploadForm.getAll('removed_attachment_ids')).toEqual(['12'])
    expect(api.post.mock.calls.filter(([path]) => path === '/submissions/')).toHaveLength(0)
  })

  it('marks a removed legacy primary file separately from attachment IDs', async () => {
    api.get.mockResolvedValue({
      data: {
        results: [{
          id: 45,
          files: [{ id: 45, name: 'legacy.png', size: 6, content_type: 'image/png', preview_kind: 'submission_file' }],
        }],
      },
    })
    api.post.mockResolvedValue({ data: { uploads: [{ id: 24, name: 'replacement.png', size: 11 }] } })
    render(<ActivitySubmitModal activity={{ id: 12, title: 'Image assignment' }} isOpen onClose={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Remove legacy.png' }))
    const replacement = new File(['replacement'], 'replacement.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [replacement] } })

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/student/submissions/upload', expect.any(FormData), expect.any(Object)))
    const uploadForm = api.post.mock.calls.find(([path]) => path === '/student/submissions/upload')[1]
    expect(uploadForm.get('remove_primary_file')).toBe('true')
    expect(uploadForm.getAll('removed_attachment_ids')).toEqual([])
    expect(api.post.mock.calls.filter(([path]) => path === '/submissions/')).toHaveLength(0)
  })

  it('rejects combined submission files over 10 GB before starting an upload', async () => {
    api.get.mockResolvedValue({ data: { results: [] } })
    render(<ActivitySubmitModal activity={{ id: 10, title: 'Video assignment' }} isOpen onClose={vi.fn()} />)

    await screen.findByRole('button', { name: 'Choose Files' })
    const first = new File(['video'], 'first.mp4', { type: 'video/mp4' })
    const second = new File(['video'], 'second.mp4', { type: 'video/mp4' })
    Object.defineProperty(first, 'size', { value: 5 * 1024 ** 3 })
    Object.defineProperty(second, 'size', { value: 5 * 1024 ** 3 + 1 })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [first, second] } })

    expect(await screen.findByText(/Combined submission files must not exceed 10 GB/)).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
  })
})