import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import api from '../../services/api.js'
import UserImportWizard from './UserImportWizard.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

describe('UserImportWizard', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('adds multiple files, previews without importing, and confirms the same batch', async () => {
    const imported = vi.fn()
    const preview = {
      total_rows: 2,
      valid_rows: 1,
      invalid_rows: 0,
      duplicate_rows: 1,
      rows: [
        { row_number: 2, file: 'students.csv', source_row_number: 2, full_name: 'Avery Example', identifier: 'STU-1', sections: ['Section A'], validation_status: 'Valid', error_message: '' },
        { row_number: 3, file: 'late-addition.csv', source_row_number: 2, full_name: 'Casey Example', identifier: 'STU-1', sections: ['Section A'], validation_status: 'Duplicate', error_message: 'Duplicate student ID.' },
      ],
    }
    api.post.mockImplementation((path) => {
      if (path === '/users/import/preview/') return Promise.resolve({ data: preview })
      if (path === '/users/import/confirm/') return Promise.resolve({ data: { successfully_imported: 1, skipped: 1, failed: 0, errors: [] } })
      throw new Error(`Unexpected POST ${path}`)
    })
    render(<UserImportWizard isOpen onClose={vi.fn()} onImported={imported} />)

    fireEvent.click(screen.getByRole('button', { name: 'Import Students' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const file = new File(['csv-data'], 'students.csv', { type: 'text/csv' })
    const secondFile = new File(['more-csv-data'], 'late-addition.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.change(input, { target: { files: [secondFile] } })
    const discardedFile = new File(['discarded'], 'discarded.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [discardedFile] } })
    expect(await screen.findByText('discarded.csv')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove discarded.csv' }))
    expect(screen.getByText('students.csv')).toBeTruthy()
    expect(screen.getByText('late-addition.csv')).toBeTruthy()
    expect(screen.queryByText('discarded.csv')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Avery Example')).toBeTruthy()
    expect(screen.getByText('Duplicate')).toBeTruthy()
    expect(screen.getByText('late-addition.csv')).toBeTruthy()
    expect(screen.getByText('2', { selector: 'p' })).toBeTruthy()
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.post.mock.calls[0][0]).toBe('/users/import/preview/')
    expect(api.post.mock.calls[0][1].getAll('files')).toEqual([file, secondFile])
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Confirm Student import' })).toBeTruthy()
    expect(api.post).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Import' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    expect(api.post.mock.calls[1][0]).toBe('/users/import/confirm/')
    expect(api.post.mock.calls[1][1].getAll('files')).toEqual([file, secondFile])
    expect(await screen.findByRole('heading', { name: 'Import Results' })).toBeTruthy()
    expect(screen.getByText('Successfully imported')).toBeTruthy()
    expect(imported).toHaveBeenCalledWith({ successfully_imported: 1, skipped: 1, failed: 0, errors: [] })
  })
})
