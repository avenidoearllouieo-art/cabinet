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
    <div className="admin-summary-card flex min-h-[104px] cursor-default items-center justify-between rounded-2xl border border-[#dbe5f0] bg-white p-5 shadow-[0_8px_24px_rgba(25,55,89,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#b9cbe0] hover:shadow-[0_14px_30px_rgba(25,55,89,0.10)]">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl p-2.5 ${iconBg} ${iconColor}`}>
          {iconContent}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-semibold leading-5 text-[#28415f]">{title}</p>
          {trendText && (
            <p className={`mt-1 text-xs font-medium leading-5 ${trendColor || 'text-slate-500'}`}>
              {trendText}
            </p>
          )}
        </div>
      </div>

      <p className="ml-3 shrink-0 text-3xl font-bold tracking-tight text-[#102a4c]">{value}</p>
    </div>
  )
}
