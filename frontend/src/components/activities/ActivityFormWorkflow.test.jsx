import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import api from '../../services/api.js'
import ActivityFormWorkflow from './ActivityFormWorkflow.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))

describe('ActivityFormWorkflow', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  it('advances Step 3 to Review and creates once only on final publish', async () => {
    const saved = vi.fn()
    const file = new File(['report'], 'brief.pdf', { type: 'application/pdf' })
    api.get.mockResolvedValue({ data: [{ id: 3, section_name: 'Section A' }] })
    api.post.mockResolvedValue({ data: { id: 5, attachments: [] } })
    render(<ActivityFormWorkflow isOpen onSaved={saved} />)

    fireEvent.change(await screen.findByLabelText(/Activity title/), { target: { value: 'Systems Lab' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Analyze the system.' } })
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Submit a short report.' } })
    fireEvent.keyDown(screen.getByLabelText(/Activity title/), { key: 'Enter', code: 'Enter' })
    expect(screen.getByText('Step 1 of 4: Activity Details')).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Section A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Step 3 of 4: Deadline & Files')).toBeTruthy()
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Step 4 of 4: Review & Publish')).toBeTruthy()
    expect(screen.getByText('Review and publish')).toBeTruthy()
    expect(screen.getByText('Systems Lab')).toBeTruthy()
    expect(screen.getByText('Analyze the system.')).toBeTruthy()
    expect(screen.getByText('Submit a short report.')).toBeTruthy()
    expect(screen.getByText('brief.pdf')).toBeTruthy()
    expect(screen.queryByLabelText('Cabinet station')).toBeNull()
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByRole('dialog', { name: 'Create New Activity' }))
    expect(screen.getByRole('button', { name: 'Publish Activity' })).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(screen.getByRole('button', { name: 'Publish Activity' })).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()

    const publishButton = screen.getByRole('button', { name: 'Publish Activity' })
    fireEvent.click(publishButton)
    fireEvent.click(publishButton)

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    const payload = api.post.mock.calls[0][1]
    expect(payload.get('title')).toBe('Systems Lab')
    expect(payload.get('instructions')).toBe('Submit a short report.')
    expect(payload.get('cabinet_station')).toBeNull()
    expect(payload.get('attachments').name).toBe('brief.pdf')
    expect(saved).toHaveBeenCalledWith({ id: 5, attachments: [] })
  })

  it('preserves multiple selected attachment files and displays their metadata before publishing', async () => {
    api.get.mockResolvedValue({ data: [{ id: 3, section_name: 'Section A' }] })
    render(<ActivityFormWorkflow isOpen onSaved={vi.fn()} />)

    fireEvent.change(await screen.findByLabelText(/Activity title/), { target: { value: 'Systems Lab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Section A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const pdfFile = new File(['report'], 'brief.pdf', { type: 'application/pdf' })
    const imageFile = new File(['image-data'], 'photo.png', { type: 'image/png' })
    const fileInput = document.querySelector('input[type="file"]')
    fireEvent.change(fileInput, { target: { files: [pdfFile] } })
    fireEvent.change(fileInput, { target: { files: [imageFile] } })

    expect(document.body.textContent).toContain('brief.pdf')
    expect(document.body.textContent).toContain('photo.png')
    expect(document.body.textContent).toContain('application/pdf')
    expect(document.body.textContent).toContain('image/png')
    expect(screen.getAllByRole('button', { name: /Remove/i }).length).toBeGreaterThan(1)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Step 4 of 4: Review & Publish')).toBeTruthy()
    expect(document.body.textContent).toContain('brief.pdf')
    expect(document.body.textContent).toContain('photo.png')
  })

  it('preserves entered activity details and attachments when publishing fails', async () => {
    api.get.mockResolvedValue({ data: [{ id: 3, section_name: 'Section A' }] })
    api.post.mockRejectedValue({ response: { status: 500, data: { detail: 'Storage unavailable.' } } })
    render(<ActivityFormWorkflow isOpen onSaved={vi.fn()} />)

    fireEvent.change(await screen.findByLabelText(/Activity title/), { target: { value: 'Keep this activity' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Keep these instructions too.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Section A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const file = new File(['report'], 'preserved.pdf', { type: 'application/pdf' })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish Activity' }))

    expect(await screen.findByText('Storage unavailable.')).toBeTruthy()
    expect(document.body.textContent).toContain('Keep this activity')
    expect(document.body.textContent).toContain('Keep these instructions too.')
    expect(document.body.textContent).toContain('preserved.pdf')
    expect(screen.getByRole('button', { name: 'Publish Activity' })).toBeTruthy()
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('does not create an activity when navigating Back or cancelling the wizard', async () => {
    const onClose = vi.fn()
    api.get.mockResolvedValue({ data: [{ id: 3, section_name: 'Section A' }] })
    render(<ActivityFormWorkflow isOpen onClose={onClose} onSaved={vi.fn()} />)

    fireEvent.change(await screen.findByLabelText(/Activity title/), { target: { value: 'Unpublished activity' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Section A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Step 4 of 4: Review & Publish')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Step 3 of 4: Deadline & Files')).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Step 4 of 4: Review & Publish')).toBeTruthy()

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('shows a per-file instructor attachment limit error before publish', async () => {
    api.get.mockResolvedValue({ data: [{ id: 3, section_name: 'Section A' }] })
    render(<ActivityFormWorkflow isOpen onSaved={vi.fn()} />)

    fireEvent.change(await screen.findByLabelText(/Activity title/), { target: { value: 'Systems Lab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Section A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const oversizedImage = new File(['image'], 'photo.png', { type: 'image/png' })
    Object.defineProperty(oversizedImage, 'size', { value: 20 * 1024 * 1024 + 1 })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [oversizedImage] } })

    expect(await screen.findByText(/photo\.png: Image files must be 20 MB or smaller/)).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
  })
})