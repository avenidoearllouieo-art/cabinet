export default function PageHeader({ title, description, action, compact = false }) {
  return (
    <div className={`admin-page-header flex min-w-0 flex-col items-start justify-between sm:flex-row sm:items-center ${compact ? 'mb-0 gap-3' : 'mb-7 gap-4'}`}>
      <div className="min-w-0 flex-1">
        <h1 className={`${compact ? 'text-xl sm:text-[28px]' : 'text-2xl tracking-[-0.02em] sm:text-[28px] lg:text-[32px]'} break-words font-bold text-[#102a4c]`}>{title}</h1>
        <p className={`${compact ? 'mt-1' : 'mt-2'} text-sm text-[#64748b]`}>{description}</p>
      </div>
      {action && <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{action}</div>}
    </div>
  )
}
