import { Fragment, useEffect, useState } from 'react'

export default function DataTable({ columns, data, rows, loading, onRowClick, showActions = true, emptyMessage = 'No data available', rowClassName, variant = 'default', expandable = false, renderExpandedRow, renderMobileCard, constrainTableHeight = true, tableClassName = 'w-full min-w-[680px] table-auto border-collapse text-xs sm:text-sm', tableWrapperClassName = '' }) {
  const tableData = Array.isArray(data) ? data : Array.isArray(rows) ? rows : []
  const hasData = tableData.length > 0
  const addActionsColumn = showActions && !columns.some((c) => c.key === 'actions')
  const [expandedRows, setExpandedRows] = useState(() => new Set())
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 600)
  const primaryColumn = columns.find((column) => ['title', 'name', 'student_name', 'activity_title', 'section_name', 'username'].includes(column.key)) || columns[0]
  const mobileDetailColumns = columns.filter((column) => column !== primaryColumn)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 600)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const renderCell = (col, row) => {
    const rawValue = row[col.key]
    const hasPresentValue = rawValue !== null && rawValue !== undefined && !(typeof rawValue === 'string' && !rawValue.trim())
    const cellValue = col.render
      ? col.render(rawValue, row)
      : hasPresentValue
        ? rawValue
        : 'No value recorded'

    if (typeof cellValue === 'string' || typeof cellValue === 'number') {
      const text = String(cellValue)
      return (
        <span title={text} className="block max-w-full whitespace-normal break-words">
          {text}
        </span>
      )
    }

    return cellValue
  }

  const toggleExpandedRow = (rowKey) => {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
  }

  const renderEditAction = (row) => (
    <button
      type="button"
      data-user-id={(row?.id ?? row?.pk ?? row?.user_id ?? row?.uuid) || ''}
      onClick={(event) => {
        event.stopPropagation()
        try {
          const id = row?.id ?? row?.pk ?? row?.user_id ?? row?.uuid
          if (window.openEditModal) window.openEditModal(id, row)
        } catch {
          /* ignore */
        }
      }}
      style={{ pointerEvents: 'auto', position: 'relative', zIndex: 50 }}
      className="min-h-10 rounded-md bg-taptrack-gold px-3 py-2 text-xs font-semibold text-taptrack-navy shadow-sm transition hover:bg-taptrack-gold-hover sm:min-h-8 sm:px-2 sm:py-1 sm:text-xs lg:min-h-9 lg:px-3"
    >
      Edit User
    </button>
  )

  return (
    <div className={`admin-data-table relative w-full overflow-hidden rounded-xl border border-[#dbe5f0] bg-white shadow-sm ${variant === 'instructor' ? 'instructor-data-table' : ''}`}>
      {isMobile ? (
      <div data-testid="mobile-record-list" className="space-y-2 p-2">
        {loading && (
          <div className="flex items-center justify-center gap-3 px-3 py-7 text-center text-sm text-[#64748b]" role="status">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-slate-500" />
            <span>Loading records…</span>
          </div>
        )}

        {!loading && !hasData && (
          <div className="rounded-lg border border-dashed border-[#cbd8e6] bg-[#f7f9fc] px-4 py-6 text-center">
            <p className="text-sm font-semibold text-[#28415f]">{emptyMessage}</p>
            <p className="mt-1 text-xs text-slate-500">Try adjusting your filters or search terms.</p>
          </div>
        )}

        {!loading && hasData && tableData.map((row, idx) => {
          const rowKey = String(row?.id ?? row?.pk ?? row?.user_id ?? idx)
          const isExpanded = expandable && expandedRows.has(rowKey)
          if (renderMobileCard) {
            return (
              <article key={rowKey} className="min-w-0 rounded-lg border border-[#dbe5f0] bg-white p-3 shadow-sm">
                {renderMobileCard(row, {
                  expanded: isExpanded,
                  toggleExpanded: () => toggleExpandedRow(rowKey),
                  onView: () => onRowClick?.(row),
                })}
              </article>
            )
          }
          return (
            <article key={rowKey} className="min-w-0 rounded-lg border border-[#dbe5f0] bg-white p-3 shadow-sm">
              <div className="flex min-w-0 items-start gap-2">
                {expandable && (
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} row ${idx + 1}`}
                    onClick={() => toggleExpandedRow(rowKey)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107]"
                  >
                    {isExpanded ? '−' : '+'}
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  {primaryColumn && <p className="text-[10px] font-semibold uppercase leading-4 text-slate-500">{primaryColumn.label}</p>}
                  {primaryColumn && <div className="break-words text-sm font-semibold text-[#28415f]">{renderCell(primaryColumn, row)}</div>}
                </div>
                {onRowClick && (
                  <button
                    type="button"
                    onClick={() => onRowClick(row)}
                    className="min-h-10 shrink-0 rounded-md px-2 text-xs font-semibold text-[#002B5B] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107]"
                  >
                    View
                  </button>
                )}
              </div>

              {mobileDetailColumns.length > 0 && (
                <dl className="mt-2 grid grid-cols-1 gap-1 border-t border-slate-100 pt-2">
                  {mobileDetailColumns.map((column) => (
                    <div key={`${rowKey}-${column.key}`} className="grid min-w-0 grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] items-start gap-3 py-1 text-xs">
                      <dt className="break-words font-medium text-slate-500">{column.label}</dt>
                      <dd className="min-w-0 break-words text-right text-slate-700">{renderCell(column, row)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {addActionsColumn && <div className="mt-2 border-t border-slate-100 pt-2">{renderEditAction(row)}</div>}
              {isExpanded && renderExpandedRow && (
                <div className="mt-2 border-t border-slate-100 pt-2 text-sm text-slate-700">{renderExpandedRow(row)}</div>
              )}
            </article>
          )
        })}
      </div>
      ) : (
      <div>
      <div className={`relative overflow-x-auto ${tableWrapperClassName || ''} ${constrainTableHeight ? 'max-h-[600px] overflow-y-auto' : 'overflow-y-visible'}`}>
      <table className={tableClassName}>
        <thead className="bg-[#f7f9fc]">
          <tr>
            {expandable && <th className="w-10 border-b border-[#dfe5eb] bg-[#f7f9fc] px-2 py-3 text-center text-xs font-semibold uppercase text-[#64748b]" aria-label="Expand row">+</th>}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`sticky top-0 z-20 whitespace-normal break-words border-b border-[#dfe5eb] bg-[#f7f9fc] px-3 py-3 text-left text-xs font-semibold uppercase text-[#64748b] ${col.className || ''}`}
              >
                {col.label}
              </th>
            ))}
            {addActionsColumn && (
                <th className="sticky top-0 z-20 border-b border-[#dfe5eb] bg-[#f7f9fc] px-3 py-3 text-left text-xs font-semibold uppercase text-[#64748b]">
                Action
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {loading && (
            <tr>
              <td colSpan={columns.length + (addActionsColumn ? 1 : 0) + (expandable ? 1 : 0)} className="px-3 py-8 text-center text-[#64748b] sm:px-6 sm:py-12">
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-500" />
                  <span>Loading records…</span>
                </div>
              </td>
            </tr>
          )}

          {!loading && !hasData && (
            <tr>
              <td colSpan={columns.length + (addActionsColumn ? 1 : 0) + (expandable ? 1 : 0)} className="px-3 py-8 text-center text-[#64748b] sm:px-6 sm:py-16">
                <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-[#cbd8e6] bg-[#f7f9fc] px-6 py-10">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
                    <span className="text-2xl">📭</span>
                  </div>
                  <p className="text-lg font-semibold text-[#28415f]">{emptyMessage}</p>
                  <p className="text-sm text-slate-500">Try adjusting your filters or search terms.</p>
                </div>
              </td>
            </tr>
          )}

          {!loading && hasData && tableData.map((row, idx) => (
            (() => {
              const rowKey = String(row?.id ?? row?.pk ?? row?.user_id ?? idx)
              const isExpanded = expandable && expandedRows.has(rowKey)
              return (
                <Fragment key={rowKey}>
                  <tr
                    onClick={() => onRowClick?.(row)}
                    className={`h-12 transition-colors duration-200 ${onRowClick ? 'cursor-pointer hover:bg-[#f4f8fc]' : variant === 'monitoring' ? 'hover:bg-[#f4f8fc]' : ''} ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfcfe]'} ${typeof rowClassName === 'function' ? (rowClassName(row, idx) || '') : (rowClassName || '')}`}
                  >
                    {expandable && <td className="w-10 px-2 py-2 text-center">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} row ${idx + 1}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleExpandedRow(rowKey)
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-sm font-semibold leading-none text-slate-700 hover:bg-slate-50"
                      >
                        {isExpanded ? '−' : '+'}
                      </button>
                    </td>}
                    {columns.map((col) => (
                      <td key={`${rowKey}-${col.key}`} data-column={col.key} className={`min-w-0 whitespace-normal break-words px-3 py-3 align-middle text-[#39506c] ${col.className || ''}`}>
                        {renderCell(col, row)}
                      </td>
                    ))}
                    {addActionsColumn && <td className="min-w-0 whitespace-normal break-words px-3 py-3 align-middle text-[#374151]">{renderEditAction(row)}</td>}
                  </tr>
                  {isExpanded && (
                    <tr key={`${rowKey}-expanded`} className="bg-slate-50">
                      <td colSpan={columns.length + (addActionsColumn ? 1 : 0) + (expandable ? 1 : 0)} className="border-b border-slate-200 px-3 py-3 sm:px-5">
                        <div className="text-xs text-slate-700 sm:text-sm">{renderExpandedRow?.(row)}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })()
          ))}
        </tbody>
      </table>
      </div>
      </div>
      )}
    </div>
  )
}
