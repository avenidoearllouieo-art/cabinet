export default function DataTable({ columns, data, rows, loading, onRowClick, showActions = true, emptyMessage = 'No data available', rowClassName, variant = 'default' }) {
  const tableData = Array.isArray(data) ? data : Array.isArray(rows) ? rows : []
  const hasData = tableData.length > 0
  const addActionsColumn = showActions && !columns.some((c) => c.key === 'actions')

  const renderCell = (col, row) => {
    const cellValue = col.render ? col.render(row[col.key], row) : row[col.key] ?? '—'

    if (typeof cellValue === 'string' || typeof cellValue === 'number') {
      const text = String(cellValue)
      return (
        <span title={text} className="block max-w-full truncate">
          {text}
        </span>
      )
    }

    return cellValue
  }

  return (
    <div className="relative max-h-[600px] overflow-auto rounded-[12px] border border-[#E5E7EB] bg-white shadow-sm">
      <table className="min-w-full table-fixed text-sm">
        <thead className="bg-[#F9FAFB]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`sticky top-0 z-20 bg-[#F9FAFB] px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide shadow-sm ${variant === 'monitoring' ? 'text-taptrack-navy' : 'text-[#6B7280]'} ${col.className || 'whitespace-nowrap'}`}
              >
                {col.label}
              </th>
            ))}
            {addActionsColumn && (
              <th className={`sticky top-0 z-20 whitespace-nowrap bg-[#F9FAFB] px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide shadow-sm ${variant === 'monitoring' ? 'text-taptrack-navy' : 'text-[#6B7280]'}`}>
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {loading && (
            <tr>
              <td colSpan={columns.length + (addActionsColumn ? 1 : 0)} className="px-6 py-10 text-center text-[#6B7280]">
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-500" />
                  <span>Loading users…</span>
                </div>
              </td>
            </tr>
          )}

          {!loading && !hasData && (
            <tr>
              <td colSpan={columns.length + (addActionsColumn ? 1 : 0)} className="px-6 py-16 text-center text-[#6B7280]">
                <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
                    <span className="text-2xl">📭</span>
                  </div>
                  <p className="text-lg font-semibold text-slate-900">{emptyMessage}</p>
                  <p className="text-sm text-slate-500">Try adjusting your filters or add a new user.</p>
                </div>
              </td>
            </tr>
          )}

          {!loading && hasData && tableData.map((row, idx) => (
            <tr
              key={idx}
              onClick={() => onRowClick?.(row)}
              className={`min-h-14 h-14 transition-colors duration-200 ${onRowClick ? 'cursor-pointer hover:bg-slate-100' : variant === 'monitoring' ? 'hover:bg-slate-100' : ''} ${idx % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]'} ${typeof rowClassName === 'function' ? (rowClassName(row, idx) || '') : (rowClassName || '')}`}
            >
              {columns.map((col) => (
                <td key={`${idx}-${col.key}`} className={`px-6 py-4 align-middle text-[#374151] ${col.className || 'whitespace-nowrap'}`}>
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
                      } catch (err) {
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
  )
}
