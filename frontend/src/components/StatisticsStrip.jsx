import { CheckCircle2, AlertCircle, Box, Users } from 'lucide-react'

const iconMap = {
  successful: CheckCircle2,
  denied: AlertCircle,
  sessions: Box,
  users: Users,
}

export default function StatisticsStrip({ items = [], loading = false, error = '', onRetry }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Statistics summary">
      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>Statistics unavailable</span>
          {onRetry && <button type="button" onClick={onRetry} className="min-h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold">Retry</button>}
        </div>
      )}
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 sm:divide-y-0">
        {items.map((item) => {
          const Icon = iconMap[item.key] || Box
          const value = loading ? 'Loading' : error ? 'Unavailable' : item.value
          return (
            <div key={item.key} className="flex min-h-[84px] items-center gap-3 px-3 py-3 sm:px-5">
              <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-taptrack-navy sm:flex"><Icon size={18} /></span>
              <div className="min-w-0">
                <strong className="block text-2xl leading-none text-taptrack-navy">{value === null || value === undefined ? 'Unavailable' : value}</strong>
                <span className="mt-1 block text-xs font-semibold text-slate-500">{item.label}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
