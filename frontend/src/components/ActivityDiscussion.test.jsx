import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import api from '../services/api.js'
import ActivityDiscussion from './ActivityDiscussion.jsx'

vi.mock('../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))

const existingMessage = {
  id: 1,
  sender: 2,
  sender_name: 'Mika',
  sender_last_name: 'Reyes',
  sender_role: 'student',
  message: 'First response',
  created_at: '2026-11-14T01:00:00Z',
  attachments: [],
}

describe('ActivityDiscussion', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('shows a confirmed instructor post immediately in chronological thread order', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'instructor', username: 'teacher' }))
    const savedMessage = {
      id: 2,
      activity: 5,
      sender: 1,
      sender_name: 'Rae',
      sender_last_name: 'Santos',
      sender_role: 'instructor',
      message: 'Review the attached notes.',
      created_at: '2026-11-14T02:00:00Z',
      attachments: [{ id: 10, filename: 'notes.pdf', url: '/media/notes.pdf' }],
    }
    api.get.mockResolvedValue({ data: { results: [existingMessage] } })
    api.post.mockResolvedValue({ data: savedMessage })
    render(<ActivityDiscussion activityId={5} />)

    expect(await screen.findByText('First response')).toBeTruthy()
    expect(screen.getByText('Classroom discussion for this activity.')).toBeTruthy()
    const thread = screen.getByText('First response').closest('article').parentElement.parentElement
    expect(thread.className).toContain('divide-y')
    expect(thread.className).toContain('overflow-visible')
    expect(thread.className).not.toContain('overflow-y-auto')
    const messageInput = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(messageInput, { target: { value: savedMessage.message } })
    const sendButton = screen.getByRole('button', { name: 'Send' })
    fireEvent.click(sendButton)
    fireEvent.click(sendButton)

    expect(await screen.findByText(savedMessage.message)).toBeTruthy()
    expect(screen.getByText('notes.pdf')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open File' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Instructor')).toBeTruthy()
    const firstPost = screen.getByText('First response').closest('article')
    const nextPost = screen.getByText(savedMessage.message).closest('article')
    expect(firstPost.compareDocumentPosition(nextPost) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('updates and removes messages only after the API confirms each action', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'instructor', username: 'teacher' }))
    api.get.mockResolvedValue({ data: [existingMessage] })
    api.patch.mockResolvedValue({ data: { ...existingMessage, message: 'Edited response' } })
    api.delete.mockResolvedValue({ status: 204 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ActivityDiscussion activityId={5} />)

    expect(await screen.findByText('First response')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Edited response' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Edited response')).toBeTruthy()
    expect(api.get).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/activity-discussions/1/', expect.any(FormData)))
    expect(api.patch.mock.calls[0][1].get('message')).toBe('Edited response')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/activity-discussions/1/'))
    await waitFor(() => expect(screen.queryByText('Edited response')).toBeNull())
  })

  it('renders instructor posts in the same aligned thread for students', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 2, role: 'student', username: 'student' }))
    const instructorMessage = {
      ...existingMessage,
      id: 4,
      sender: 1,
      sender_name: 'Rae',
      sender_last_name: 'Santos',
      sender_role: 'instructor',
      message: 'Please review the lab notes.',
    }
    api.get.mockResolvedValue({ data: { results: [instructorMessage] } })
    render(<ActivityDiscussion activityId={5} />)

    expect(await screen.findByText('Please review the lab notes.')).toBeTruthy()
    expect(screen.getByText('Classroom discussion for this activity.')).toBeTruthy()
    expect(screen.getByText('Instructor')).toBeTruthy()
    expect(screen.getByRole('article').className).toContain('border-b')
    expect(screen.getByRole('article').className).not.toContain('max-w-[84%]')
  })

  it('shows a failed send without adding a false message', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 2, role: 'student', username: 'student' }))
    api.get.mockResolvedValue({ data: [] })
    api.post.mockRejectedValue(new Error('Network unavailable'))
    render(<ActivityDiscussion activityId={5} />)

    const message = 'This message should not appear.'
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: message } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Unable to send message.')
    expect(screen.getByRole('textbox', { name: 'Message' }).value).toBe(message)
    expect(screen.queryByRole('article')).toBeNull()
    expect(api.post).toHaveBeenCalledTimes(1)
  })
})