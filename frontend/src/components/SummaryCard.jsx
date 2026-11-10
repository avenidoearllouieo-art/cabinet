import { cloneElement, isValidElement } from 'react'

export default function SummaryCard({
  title,
  value,
  icon: Icon,
  trendText,
  mobileTrendText,
  trendColor,
  iconBg = 'bg-blue-50',
  iconColor = 'text-blue-900',
}) {
  const iconClassName = `${isValidElement(Icon) ? Icon.props.className || '' : ''} stat-card-icon h-5 w-5 sm:h-[18px] sm:w-[18px]`.trim()
  const iconContent = isValidElement(Icon)
    ? cloneElement(Icon, { size: 20, className: iconClassName })
    : Icon
      ? (() => {
          const IconComponent = Icon
          return <IconComponent size={20} className={iconClassName} />
        })()
      : null

  return (
    <article className="admin-summary-card flex min-h-[104px] min-w-0 items-center gap-2 overflow-hidden rounded-xl border border-[#dbe5f0] bg-white px-3 py-3 shadow-sm sm:h-[120px] sm:min-h-0 sm:gap-3 sm:px-4">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg} ${iconColor} sm:h-11 sm:w-11`}>
          {iconContent}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <p className="line-clamp-2 break-words text-xs font-semibold leading-4 text-[#28415f] sm:truncate sm:text-sm sm:leading-5" title={title}>{title}</p>
        <p className="truncate text-2xl font-bold leading-7 text-[#102a4c] sm:text-[26px]" title={String(value)}>{value}</p>
        <p className={`hidden truncate text-xs leading-4 sm:block ${trendColor || 'text-slate-500'}`} title={trendText}>{trendText || '\u00a0'}</p>
        <p className={`truncate text-[10px] leading-3 sm:hidden ${trendColor || 'text-slate-500'}`} title={mobileTrendText || trendText}>{mobileTrendText || trendText || '\u00a0'}</p>
      </div>
    </article>
  )
}
