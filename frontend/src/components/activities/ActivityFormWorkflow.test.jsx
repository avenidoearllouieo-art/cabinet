import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import api from '../../services/api.js'
import ActivityFormWorkflow from './ActivityFormWorkflow.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))

describe('ActivityFormWorkflow', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  it('advances Step 3 to Review and creates once only on final confirmation', async () => {
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
    expect(screen.getByText('Review activity')).toBeTruthy()
    expect(screen.getByText('Systems Lab')).toBeTruthy()
    expect(screen.getByText('Analyze the system.')).toBeTruthy()
    expect(screen.getByText('Submit a short report.')).toBeTruthy()
    expect(screen.getByText('brief.pdf')).toBeTruthy()
    expect(screen.queryByLabelText('Cabinet station')).toBeNull()
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByRole('dialog', { name: 'Create New Activity' }))
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()

    const saveDraftButton = screen.getByRole('button', { name: 'Save as Draft' })
    fireEvent.click(saveDraftButton)
    fireEvent.click(saveDraftButton)

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    const payload = api.post.mock.calls[0][1]
    expect(payload.get('title')).toBe('Systems Lab')
    expect(payload.get('instructions')).toBe('Submit a short report.')
    expect(payload.get('status')).toBe('Draft')
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

  it('creates a Published activity only after explicit publish confirmation', async () => {
    api.get.mockResolvedValue({ data: [{ id: 3, section_name: 'Section A' }] })
    api.post.mockResolvedValue({ data: { id: 8, status: 'Published' } })
    render(<ActivityFormWorkflow isOpen onSaved={vi.fn()} />)

    fireEvent.change(await screen.findByLabelText(/Activity title/), { target: { value: 'Published activity' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Section A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(api.post).not.toHaveBeenCalled()
    const status = screen.getByRole('combobox', { name: /Activity status/ })
    expect(status.value).toBe('Draft')
    expect(screen.getAllByRole('button', { name: /Save as Draft|Publish Activity/ })).toHaveLength(1)
    fireEvent.change(status, { target: { value: 'Published' } })
    expect(status.value).toBe('Published')
    expect(api.post).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save as Draft' })).toBeNull()
    fireEvent.change(status, { target: { value: 'Draft' } })
    expect(status.value).toBe('Draft')
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.change(status, { target: { value: 'Published' } })
    const publish = screen.getByRole('button', { name: 'Publish Activity' })
    fireEvent.click(publish)
    fireEvent.click(publish)

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(api.post.mock.calls[0][1].get('status')).toBe('Published')
    expect(screen.getAllByRole('button', { name: /Save as Draft|Publish Activity/ })).toHaveLength(1)
  })

  it('saves an edited Draft without publishing and then honors explicit Publish', async () => {
    const draft = { id: 5, title: 'Existing draft', status: 'Draft', assigned_sections: [{ id: 3, section_name: 'Section A' }], attachments: [], max_score: 100 }
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/activities/5/' ? draft : [{ id: 3, section_name: 'Section A' }] }))
    api.patch.mockImplementation((_path, body) => Promise.resolve({ data: { ...draft, status: body.get('status') } }))
    render(<ActivityFormWorkflow isOpen mode="edit" activityId={5} onSaved={vi.fn()} />)

    expect(await screen.findByDisplayValue('Existing draft')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('combobox', { name: /Activity status/ }).value).toBe('Draft')
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
    expect(api.patch.mock.calls[0][1].get('status')).toBe('Draft')
    fireEvent.change(screen.getByRole('combobox', { name: /Activity status/ }), { target: { value: 'Published' } })
    expect(api.patch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Publish Activity' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Publish Activity' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2))
    expect(api.patch.mock.calls[1][1].get('status')).toBe('Published')
    expect(screen.getByRole('combobox', { name: /Activity status/ }).value).toBe('Published')
  })

  it('initializes an existing Published activity and updates it with one primary action', async () => {
    const published = {
      id: 8,
      title: 'Existing published activity',
      status: 'Published',
      assigned_sections: [{ id: 3, section_name: 'Section A' }],
      attachments: [{ id: 21, filename: 'existing.pdf' }],
      max_score: 100,
    }
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/activities/8/' ? published : [{ id: 3, section_name: 'Section A' }] }))
    api.patch.mockResolvedValue({ data: published })
    render(<ActivityFormWorkflow isOpen mode="edit" activityId={8} onSaved={vi.fn()} />)

    await screen.findByDisplayValue('Existing published activity')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('combobox', { name: /Activity status/ }).value).toBe('Published')
    expect(screen.getAllByRole('button', { name: /Save as Draft|Publish Activity/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Publish Activity' })).toBeTruthy()
    expect(document.body.textContent).toContain('existing.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Publish Activity' }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
    expect(api.patch).toHaveBeenCalledWith('/activities/8/', expect.any(FormData))
    expect(api.patch.mock.calls[0][1].get('status')).toBe('Published')
    expect(api.post).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))

    expect(await screen.findByText('Storage unavailable.')).toBeTruthy()
    expect(document.body.textContent).toContain('Keep this activity')
    expect(document.body.textContent).toContain('Keep these instructions too.')
    expect(document.body.textContent).toContain('preserved.pdf')
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toBeTruthy()
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Back' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(false)
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

  it('keeps Cancel, Back, and one dynamic primary action in the sticky footer at phone and desktop widths', async () => {
    const originalWidth = window.innerWidth
    api.get.mockResolvedValue({ data: [{ id: 3, section_name: 'Section A' }] })

    for (const width of [375, 1280]) {
      cleanup()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      render(<ActivityFormWorkflow isOpen onSaved={vi.fn()} />)
      fireEvent.change(await screen.findByLabelText(/Activity title/), { target: { value: 'Responsive activity' } })
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Section A' }))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const footer = screen.getByRole('contentinfo')
      expect(footer.className).toContain('sticky')
      expect(footer.className).toContain('bg-white')
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
      expect(within(footer).getAllByRole('button', { name: /Save as Draft|Publish Activity/ })).toHaveLength(1)
      expect(api.post).not.toHaveBeenCalled()
    }

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
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