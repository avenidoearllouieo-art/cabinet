import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../../services/api.js'
import AssignInstructorModal from './AssignInstructorModal.jsx'

vi.mock('../../services/api.js', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
}))

const sections = [{ id: 8, section_name: 'Section A', subject_code: 'CS-101', instructor: null }]
const instructors = [
  { id: 14, role: 'instructor', instructor_id: 'INS-14', first_name: 'Rae', last_name: 'Santos', email: 'rae@example.test', is_active: true },
  { id: 15, role: 'instructor', instructor_id: 'INS-15', first_name: 'Inactive', last_name: 'Instructor', is_active: false },
  { id: 16, role: 'student', student_id: 'ST-16', first_name: 'Not', last_name: 'Instructor', is_active: true },
]

describe('AssignInstructorModal', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({ data: { count: instructors.length, next: null, results: instructors } })
    api.patch.mockResolvedValue({ data: [{ ...sections[0], instructor: 14, instructor_name: 'Rae Santos' }] })
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('loads registered instructors and assigns the selected sections', async () => {
    const user = userEvent.setup()
    const onAssigned = vi.fn()
    const onClose = vi.fn()
    render(<AssignInstructorModal isOpen sections={sections} onAssigned={onAssigned} onClose={onClose} />)

    expect(await screen.findByRole('option', { name: /Rae Santos.*INS-14.*rae@example.test/ })).toBeTruthy()
    expect(screen.queryByLabelText('Find instructor')).toBeNull()
    expect(screen.queryByRole('option', { name: /Inactive Instructor/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /Not Instructor/ })).toBeNull()
    expect(api.get).toHaveBeenCalledWith('/users/', { params: { role: 'instructor', page_size: 100, page: 1 } })
    const dropdown = screen.getByRole('combobox', { name: 'Instructor' })
    expect(screen.getByRole('button', { name: 'Confirm Assignment' }).disabled).toBe(true)
    await user.selectOptions(dropdown, '14')
    await user.click(screen.getByRole('button', { name: 'Confirm Assignment' }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/sections/assign-instructor/', {
      section_ids: [8],
      instructor_id: 14,
    }, { timeout: 30_000 }))
    expect(onAssigned).toHaveBeenCalledWith([{ ...sections[0], instructor: 14, instructor_name: 'Rae Santos' }])
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('requires explicit confirmation before replacing an assigned instructor', async () => {
    const user = userEvent.setup()
    render(<AssignInstructorModal isOpen sections={[{ ...sections[0], instructor: 12, instructor_name: 'Current Instructor' }]} />)

    await screen.findByRole('option', { name: /Rae Santos/ })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Instructor' }), '14')
    const confirmButton = screen.getByRole('button', { name: 'Confirm Assignment' })
    expect(confirmButton.disabled).toBe(true)
    await user.click(screen.getByRole('checkbox', { name: /Replace the current instructor/ }))
    await user.click(confirmButton)

    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce())
  })

  it('does not save when cancelled', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AssignInstructorModal isOpen sections={sections} onClose={onClose} />)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(api.patch).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows backend assignment errors', async () => {
    const user = userEvent.setup()
    api.patch.mockRejectedValue({ response: { status: 400, data: { instructor_id: ['Select a registered instructor.'] } } })
    render(<AssignInstructorModal isOpen sections={sections} />)
    await screen.findByRole('option', { name: /Rae Santos/ })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Instructor' }), '14')
    await user.click(screen.getByRole('button', { name: 'Confirm Assignment' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Select a registered instructor.')
    expect(screen.getByRole('combobox', { name: 'Instructor' }).value).toBe('14')
    expect(screen.getByRole('button', { name: 'Confirm Assignment' }).disabled).toBe(false)
    expect(api.patch).toHaveBeenCalledTimes(1)
  })

  it('does not render a raw HTML server error and preserves the selected instructor', async () => {
    const user = userEvent.setup()
    api.patch.mockRejectedValue({
      response: {
        status: 500,
        headers: { 'content-type': 'text/html' },
        data: '<!doctype html><title>Server Error (500)</title>',
      },
    })
    render(<AssignInstructorModal isOpen sections={sections} />)
    await screen.findByRole('option', { name: /Rae Santos/ })
    const dropdown = screen.getByRole('combobox', { name: 'Instructor' })
    await user.selectOptions(dropdown, '14')
    await user.click(screen.getByRole('button', { name: 'Confirm Assignment' }))

    expect((await screen.findByRole('alert')).textContent).toContain('The instructor assignment could not be saved.')
    expect(document.body.textContent).not.toContain('<!doctype html>')
    expect(dropdown.value).toBe('14')
    expect(screen.getByRole('button', { name: 'Confirm Assignment' }).disabled).toBe(false)
  })
})