export default function PageHeader({ title, description, action }) {
  return (
    <div className="admin-page-header mb-7 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-[#102a4c] sm:text-[32px]">{title}</h1>
        <p className="mt-2 text-sm text-[#64748b]">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
