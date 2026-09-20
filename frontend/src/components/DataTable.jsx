export default function DataTable({ columns, data, rows, loading, onRowClick, showActions = true, emptyMessage = 'No data available', rowClassName, variant = 'default', mobileCards = false }) {
  const tableData = Array.isArray(data) ? data : Array.isArray(rows) ? rows : []
  const hasData = tableData.length > 0
  const addActionsColumn = showActions && !columns.some((c) => c.key === 'actions')

  const renderCell = (col, row) => {
    const cellValue = col.render ? col.render(row[col.key], row) : row[col.key] ?? '—'

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

  return (
    <div className="admin-data-table relative rounded-2xl border border-[#dbe5f0] bg-white shadow-[0_8px_24px_rgba(25,55,89,0.06)]">
      {mobileCards && (
        <div className="divide-y divide-[#e7edf4] md:hidden">
          {loading && <div className="px-6 py-12 text-center text-[#64748b]">Loading…</div>}
          {!loading && !hasData && <div className="px-6 py-12 text-center text-[#64748b]">{emptyMessage}</div>}
          {!loading && hasData && tableData.map((row, index) => (
            <article key={row.id || index} onClick={() => onRowClick?.(row)} className="space-y-3 px-4 py-4">
              {columns.map((col) => (
                <div key={`${index}-${col.key}`} className="flex items-start justify-between gap-4">
                  <span className="shrink-0 text-xs font-bold uppercase tracking-[0.06em] text-[#64748b]">{col.label}</span>
                  <span className="min-w-0 text-right text-sm text-[#39506c]">{renderCell(col, row)}</span>
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
      <div className={mobileCards ? 'hidden overflow-auto md:block' : 'relative max-h-[600px] overflow-auto'}>
      <table className="min-w-full table-fixed text-sm">
        <thead className="bg-[#f7f9fc]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`sticky top-0 z-20 bg-[#f7f9fc] px-5 py-4 text-left text-[11px] font-bold uppercase tracking-[0.08em] shadow-sm ${variant === 'monitoring' ? 'text-taptrack-navy' : 'text-[#64748b]'} ${col.className || 'whitespace-nowrap'}`}
              >
                {col.label}
              </th>
            ))}
            {addActionsColumn && (
                <th className={`sticky top-0 z-20 whitespace-nowrap bg-[#f7f9fc] px-5 py-4 text-left text-[11px] font-bold uppercase tracking-[0.08em] shadow-sm ${variant === 'monitoring' ? 'text-taptrack-navy' : 'text-[#64748b]'}`}>
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {loading && (
            <tr>
              <td colSpan={columns.length + (addActionsColumn ? 1 : 0)} className="px-6 py-12 text-center text-[#64748b]">
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-500" />
                  <span>Loading users…</span>
                </div>
              </td>
            </tr>
          )}

          {!loading && !hasData && (
            <tr>
              <td colSpan={columns.length + (addActionsColumn ? 1 : 0)} className="px-6 py-16 text-center text-[#64748b]">
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
            <tr
              key={idx}
              onClick={() => onRowClick?.(row)}
              className={`min-h-14 h-14 transition-colors duration-200 ${onRowClick ? 'cursor-pointer hover:bg-[#f4f8fc]' : variant === 'monitoring' ? 'hover:bg-[#f4f8fc]' : ''} ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfcfe]'} ${typeof rowClassName === 'function' ? (rowClassName(row, idx) || '') : (rowClassName || '')}`}
            >
              {columns.map((col) => (
                <td key={`${idx}-${col.key}`} className={`px-5 py-4 align-middle text-[#39506c] ${col.className || 'whitespace-nowrap'}`}>
                  {renderCell(col, row)}
                </td>
              ))}
              {addActionsColumn && (
                <td className="whitespace-nowrap px-6 py-4 text-[#374151] align-middle">
                  <button
                    type="button"
                    data-user-id={(row?.id ?? row?.pk ?? row?.user_id ?? row?.uuid) || ''}
                    onClick={(e) => {
                      e.stopPropagation()
                      try {
                        const id = row?.id ?? row?.pk ?? row?.user_id ?? row?.uuid
                        if (window.openEditModal) window.openEditModal(id, row)
                      } catch {
                        /* ignore */
                      }
                    }}
                    style={{ pointerEvents: 'auto', position: 'relative', zIndex: 50 }}
                    className="min-h-11 rounded-full bg-taptrack-gold px-4 py-2 text-sm font-semibold text-taptrack-navy shadow-sm transition duration-200 hover:bg-taptrack-gold-hover"
                  >
                    Edit User
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
