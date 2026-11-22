import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import api from '../../services/api.js'
import UserFormWorkflow from './UserFormWorkflow.jsx'

vi.mock('../../services/api.js', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

describe('UserFormWorkflow', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('creates a pending student profile without login credentials', async () => {
    const onSaved = vi.fn()
    api.get.mockResolvedValue({ data: [{ id: 1, section_name: 'Section A' }] })
    api.post.mockResolvedValue({ data: { id: 9, username: 'jordan.new', role: 'student' } })

    render(<UserFormWorkflow isOpen initialRole="student" onClose={() => {}} onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Enter the user’s first name.')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: /First name/ }), { target: { value: 'Jordan' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Last name/ }), { target: { value: 'New' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Email address/ }), { target: { value: 'jordan.new@example.edu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.change(await screen.findByRole('textbox', { name: /Student ID/ }), { target: { value: 'STU-009' } })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Section A' })).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox', { name: /Section/ }), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'NFC Access & Registration' })).toBeTruthy()
    expect(screen.queryByLabelText('Username')).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: /NFC UID/ }), { target: { value: 'CARD-NEW-001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Review and create' })).toBeTruthy()
    expect(screen.getByText('Jordan New')).toBeTruthy()
    expect(screen.getByText('Pending Registration')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Delete user/i })).toBeNull()
    fireEvent.submit(screen.getByRole('dialog', { name: 'Add New User' }))
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 9 })))
    expect(api.post).toHaveBeenCalledWith('/users/', {
      email: 'jordan.new@example.edu',
      first_name: 'Jordan',
      last_name: 'New',
      role: 'student',
      student_id: 'STU-009',
      section: '1',
      administrator_id: null,
      assigned_sections: [],
      instructor_id: null,
      nfc_uid: 'CARD-NEW-001',
      is_active: true,
    })
  })

  it('does not create until Add User is explicitly clicked on Review', async () => {
    api.get.mockResolvedValue({ data: [{ id: 1, section_name: 'Section A' }] })
    api.post.mockResolvedValue({ data: { id: 9, username: 'jordan.new', role: 'student' } })
    render(<UserFormWorkflow isOpen initialRole="student" onClose={() => {}} onSaved={() => {}} />)

    await fillStudentToReview()

    expect(await screen.findByRole('heading', { name: 'Review and create' })).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add User' }).type).toBe('button')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'NFC Access & Registration' })).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Review and create' })).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('preserves the add-user draft when the parent rerenders with a new callback', async () => {
    api.get.mockResolvedValue({ data: [{ id: 1, section_name: 'Section A' }] })
    const onUnauthorized = vi.fn()
    const { rerender } = render(<UserFormWorkflow isOpen initialRole="student" onClose={() => {}} onSaved={() => {}} onUnauthorized={onUnauthorized} />)

    fireEvent.change(screen.getByRole('textbox', { name: /First name/ }), { target: { value: 'Jordan' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Last name/ }), { target: { value: 'New' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Email address/ }), { target: { value: 'jordan.new@example.edu' } })
    rerender(<UserFormWorkflow isOpen initialRole="student" canProvisionAdministrators onClose={() => {}} onSaved={() => {}} onUnauthorized={() => {}} />)

    expect(screen.getByDisplayValue('Jordan')).toBeTruthy()
    expect(screen.getByDisplayValue('New')).toBeTruthy()
    expect(screen.getByDisplayValue('jordan.new@example.edu')).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('prevents a rapid double click from creating two users', async () => {
    const onSaved = vi.fn()
    let resolveCreate
    api.get.mockResolvedValue({ data: [{ id: 1, section_name: 'Section A' }] })
    api.post.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve }))
    render(<UserFormWorkflow isOpen initialRole="student" onClose={() => {}} onSaved={onSaved} />)

    await fillStudentToReview()
    const addButton = await screen.findByRole('button', { name: 'Add User' })
    fireEvent.click(addButton)
    fireEvent.click(addButton)

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(addButton.disabled).toBe(true)
    resolveCreate({ data: { id: 9, username: 'jordan.new', role: 'student' } })
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('preserves the draft when the final create request returns validation errors', async () => {
    api.get.mockResolvedValue({ data: [{ id: 1, section_name: 'Section A' }] })
    api.post.mockRejectedValue({ response: { status: 400, data: { email: ['Email is already in use.'] } } })
    render(<UserFormWorkflow isOpen initialRole="student" onClose={() => {}} onSaved={() => {}} />)

    await fillStudentToReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add User' }))

    expect(await screen.findByRole('heading', { name: 'Personal information' })).toBeTruthy()
    expect(screen.getByDisplayValue('Jordan')).toBeTruthy()
    expect(screen.getByDisplayValue('jordan.new@example.edu')).toBeTruthy()
    expect(await screen.findByText('This value is already in use.')).toBeTruthy()
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('cancel and close before final submission never create a user', async () => {
    const onClose = vi.fn()
    api.get.mockResolvedValue({ data: [{ id: 1, section_name: 'Section A' }] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { rerender } = render(<UserFormWorkflow isOpen initialRole="student" onClose={onClose} onSaved={() => {}} />)

    await fillStudentToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(api.post).not.toHaveBeenCalled()

    rerender(<UserFormWorkflow isOpen={false} initialRole="student" onClose={onClose} onSaved={() => {}} />)
    rerender(<UserFormWorkflow isOpen initialRole="student" onClose={onClose} onSaved={() => {}} />)
    expect(screen.getByRole('textbox', { name: /First name/ }).value).toBe('')
    await fillStudentToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('cancel and close discard an edit draft, and reopening loads the latest saved data', async () => {
    const onClose = vi.fn()
    let savedUser = { id: 4, username: 'student.saved', first_name: 'Saved', last_name: 'Student', email: 'saved@example.edu', role: 'student', student_id: 'STU-004', section: { id: 1 }, is_active: true }
    api.get.mockImplementation((url) => Promise.resolve({
      data: url === '/sections/' ? [{ id: 1, section_name: 'Section A' }] : { ...savedUser },
    }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const view = render(<UserFormWorkflow isOpen userId={4} user={{ id: 4 }} mode="edit" onClose={onClose} onSaved={() => {}} />)

    expect(await screen.findByDisplayValue('saved@example.edu')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: /Email address/ }), { target: { value: 'draft@example.edu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(api.patch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    view.rerender(<UserFormWorkflow isOpen={false} userId={4} user={{ id: 4 }} mode="edit" onClose={onClose} onSaved={() => {}} />)
    savedUser = { ...savedUser, email: 'latest@example.edu' }
    view.rerender(<UserFormWorkflow isOpen userId={4} user={{ id: 4 }} mode="edit" onClose={onClose} onSaved={() => {}} />)
    expect(await screen.findByDisplayValue('latest@example.edu')).toBeTruthy()
    expect(screen.queryByDisplayValue('draft@example.edu')).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: /Email address/ }), { target: { value: 'another-draft@example.edu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(api.patch).not.toHaveBeenCalled()
    view.rerender(<UserFormWorkflow isOpen={false} userId={4} user={{ id: 4 }} mode="edit" onClose={onClose} onSaved={() => {}} />)
    view.rerender(<UserFormWorkflow isOpen userId={4} user={{ id: 4 }} mode="edit" onClose={onClose} onSaved={() => {}} />)
    expect(await screen.findByDisplayValue('latest@example.edu')).toBeTruthy()
    expect(screen.queryByDisplayValue('another-draft@example.edu')).toBeNull()
  })

  it('preserves the edit draft and reports field errors after a failed final save', async () => {
    api.get.mockImplementation((url) => Promise.resolve({
      data: url === '/sections/'
        ? [{ id: 1, section_name: 'Section A' }]
        : { id: 3, username: 'student.old', first_name: 'Jordan', last_name: 'Santos', email: 'old@example.edu', role: 'student', student_id: 'STU-003', section: { id: 1 }, is_active: true },
    }))
    api.patch.mockRejectedValue({ response: { status: 400, data: { email: ['Email address is already in use.'] } } })
    render(<UserFormWorkflow isOpen userId={3} user={{ id: 3 }} mode="edit" onClose={() => {}} onSaved={() => {}} />)

    expect(await screen.findByDisplayValue('Jordan')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: /Email address/ }), { target: { value: 'draft@example.edu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('textbox', { name: /Student ID/ })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'NFC Access & Registration' })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Review and update' })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByRole('heading', { name: 'Personal information' })).toBeTruthy()
    expect(screen.getByDisplayValue('draft@example.edu')).toBeTruthy()
    expect(await screen.findByText('This value is already in use.')).toBeTruthy()
    expect(api.patch).toHaveBeenCalledTimes(1)
  })

  it('keeps edit changes in draft through navigation and saves once only after the final click', async () => {
    const onSaved = vi.fn()
    api.get.mockImplementation((url) => Promise.resolve({
      data: url === '/sections/'
        ? [{ id: 1, section_name: 'Section A' }]
        : { id: 2, username: 'student.old', first_name: 'Jordan', last_name: 'Santos', email: 'old@example.edu', role: 'student', student_id: 'STU-002', section: { id: 1 }, is_active: true, nfc_uid: null },
    }))
    api.patch.mockResolvedValue({ data: { id: 2, username: 'student.old', email: 'new@example.edu' } })

    render(<UserFormWorkflow isOpen userId={2} user={{ id: 2 }} mode="edit" onClose={() => {}} onSaved={onSaved} />)
    expect(await screen.findByDisplayValue('Jordan')).toBeTruthy()
    expect(screen.getByDisplayValue('old@example.edu')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: /Email address/ }), { target: { value: 'new@example.edu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(api.patch).not.toHaveBeenCalled()
    await screen.findByDisplayValue('STU-002')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'NFC Access & Registration' })).toBeTruthy()
    expect(screen.queryByText('student.old')).toBeNull()
    expect(api.patch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Review and update' })).toBeTruthy()
    expect(screen.getByText('Changed')).toBeTruthy()
    expect(api.patch).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Delete user/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'NFC Access & Registration' })).toBeTruthy()
    expect(api.patch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Review and update' })).toBeTruthy()
    fireEvent.submit(screen.getByRole('dialog', { name: 'Edit User' }))
    expect(api.patch).not.toHaveBeenCalled()
    const saveButton = screen.getByRole('button', { name: 'Save Changes' })
    expect(saveButton.type).toBe('button')
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/users/2/', { email: 'new@example.edu' }))
    expect(api.patch).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })
})

async function fillStudentToReview() {
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/sections/'))
  fireEvent.change(screen.getByRole('textbox', { name: /First name/ }), { target: { value: 'Jordan' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Last name/ }), { target: { value: 'New' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Email address/ }), { target: { value: 'jordan.new@example.edu' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.change(await screen.findByRole('textbox', { name: /Student ID/ }), { target: { value: 'STU-009' } })
  await waitFor(() => expect(screen.getByRole('option', { name: 'Section A' })).toBeTruthy())
  fireEvent.change(screen.getByRole('combobox', { name: /Section/ }), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(api.post).not.toHaveBeenCalled()
  await screen.findByRole('heading', { name: 'NFC Access & Registration' })
  fireEvent.change(screen.getByRole('textbox', { name: /NFC UID/ }), { target: { value: 'CARD-NEW-001' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(api.post).not.toHaveBeenCalled()
}