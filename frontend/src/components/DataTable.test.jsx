import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import DataTable from './DataTable.jsx'

describe('DataTable mobile records', () => {
  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  })

  it('keeps all columns and row actions available in the mobile record card', () => {
    const onRowClick = vi.fn()
    const onEdit = vi.fn()
    const row = { id: 12, title: 'Field report', status: 'Submitted', section: 'BIO 101' }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    const { container } = render(
      <DataTable
        columns={[
          { key: 'title', label: 'Activity' },
          { key: 'status', label: 'Status' },
          { key: 'section', label: 'Section' },
          { key: 'actions', label: 'Actions', render: (_value, record) => <button type="button" onClick={() => onEdit(record.id)}>Edit record</button> },
        ]}
        data={[row]}
        onRowClick={onRowClick}
        showActions={false}
      />,
    )

    const mobileList = container.querySelector('[data-testid="mobile-record-list"]')
    expect(mobileList).toBeTruthy()
    expect(within(mobileList).getByText('Activity')).toBeTruthy()
    expect(within(mobileList).getByText('Status')).toBeTruthy()
    expect(within(mobileList).getByText('Submitted')).toBeTruthy()
    expect(within(mobileList).getByText('Section')).toBeTruthy()
    expect(within(mobileList).getByRole('button', { name: 'Edit record' })).toBeTruthy()

    fireEvent.click(within(mobileList).getByRole('button', { name: 'View' }))
    fireEvent.click(within(mobileList).getByRole('button', { name: 'Edit record' }))
    expect(onRowClick).toHaveBeenCalledWith(row)
    expect(onEdit).toHaveBeenCalledWith(12)
    expect(screen.queryByRole('table')).toBeNull()
  })
})