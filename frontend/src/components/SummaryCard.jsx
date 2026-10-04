import { cloneElement, isValidElement } from 'react'

export default function SummaryCard({
  title,
  value,
  icon: Icon,
  trendText,
  trendColor,
  iconBg = 'bg-blue-50',
  iconColor = 'text-blue-900',
}) {
  const iconContent = isValidElement(Icon)
    ? cloneElement(Icon, { size: 18 })
    : Icon
      ? (() => {
          const IconComponent = Icon
          return <IconComponent size={18} />
        })()
      : null

  return (
    <article className="admin-summary-card flex h-[120px] min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-[#dbe5f0] bg-white px-4 py-3 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}>
          {iconContent}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <p className="truncate text-sm font-semibold leading-5 text-[#28415f]" title={title}>{title}</p>
        <p className="truncate text-[26px] font-bold leading-7 text-[#102a4c]" title={String(value)}>{value}</p>
        <p className={`truncate text-xs leading-4 ${trendColor || 'text-slate-500'}`} title={trendText}>{trendText || '\u00a0'}</p>
      </div>
    </article>
  )
}
