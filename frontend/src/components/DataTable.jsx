export default function DataTable({ columns, data, rows, loading, onRowClick, showActions = true }) {
  const tableData = Array.isArray(data) ? data : Array.isArray(rows) ? rows : []
  const hasData = tableData.length > 0
  const addActionsColumn = showActions && !columns.some((c) => c.key === 'actions')

  return (
    <div className="relative overflow-x-auto rounded-[12px] border border-[#E5E7EB] bg-white shadow-sm">
      <table className="min-w-full table-fixed text-sm">
        <thead className="bg-[#F9FAFB]">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`whitespace-nowrap px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280] ${col.className || ''}`}>
                {col.label}
              </th>
            ))}
            {addActionsColumn && (
              <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Actions</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {loading && (
            <tr>
              <td colSpan={columns.length + (addActionsColumn ? 1 : 0)} className="px-6 py-8 text-center text-[#6B7280]">
                Loading...
              </td>
            </tr>
          )}

          {!loading && !hasData && (
            <tr>
              <td colSpan={columns.length + (addActionsColumn ? 1 : 0)} className="px-6 py-8 text-center text-[#6B7280]">
                No data available
              </td>
            </tr>
          )}

          {!loading && hasData && tableData.map((row, idx) => (
            <tr key={idx} onClick={() => onRowClick?.(row)} className={`h-14 ${onRowClick ? 'cursor-pointer hover:bg-[#F9FAFB]' : ''}`}>
              {columns.map((col) => (
                <td key={`${idx}-${col.key}`} className={`whitespace-nowrap px-6 py-3 text-[#374151] align-middle ${col.className || ''}`}>
                  {col.render ? col.render(row[col.key], row) : row[col.key] || '—'}
                </td>
              ))}
              {addActionsColumn && (
                <td className="whitespace-nowrap px-6 py-3 text-[#374151] align-middle">
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
                    className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
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
