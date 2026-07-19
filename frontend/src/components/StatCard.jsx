import { TrendingDown, TrendingUp } from 'lucide-react'

export default function StatCard({ 
  icon, 
  label, 
  value, 
  subtitle, 
  trend,
  bgColor = 'bg-blue-50',
  textColor = 'text-blue-600',
  borderColor = 'border-blue-200'
}) {
  const TrendIcon = trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : null
  const trendColor = trend?.direction === 'up' ? 'text-emerald-500' : trend?.direction === 'down' ? 'text-rose-500' : 'text-slate-500'

  return (
    <div className={`min-h-[160px] rounded-[12px] border ${borderColor} bg-white p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition`}>
      <div className="flex items-center justify-between">
        <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${bgColor} ${textColor}`}>
          {icon}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-[#6B7280]">{label}</p>
        <p className="mt-2 text-3xl font-bold text-[#111827]">{value}</p>
        {subtitle && <p className="mt-1 text-xs text-[#6B7280]">{subtitle}</p>}
        {trend?.label && (
          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-600">
            {TrendIcon && <TrendIcon className={`${trendColor} h-4 w-4`} />}
            <span className={trendColor}>{trend.label}</span>
          </div>
        )}
      </div>
    </div>
  )
}
