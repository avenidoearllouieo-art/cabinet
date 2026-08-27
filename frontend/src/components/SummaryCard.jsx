import { isValidElement } from 'react'

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
    ? Icon
    : Icon
      ? (() => {
          const IconComponent = Icon
          return <IconComponent size={18} />
        })()
      : null

  return (
    <div className="bg-white p-4 rounded-xl border-t-4 border-t-yellow-400 shadow-sm flex items-center justify-between transition-all duration-200 hover:-translate-y-1 hover:shadow-md cursor-default">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-2.5 ${iconBg} ${iconColor}`}>
          {iconContent}
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-600">{title}</p>
          {trendText && (
            <p className={`mt-1 truncate text-xs font-medium ${trendColor || 'text-slate-500'}`}>
              {trendText}
            </p>
          )}
        </div>
      </div>

      <p className="ml-3 shrink-0 text-2xl font-bold text-blue-900">{value}</p>
    </div>
  )
}
