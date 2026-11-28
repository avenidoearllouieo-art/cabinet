export function ExpandedDetail({ label, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[11px] font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-800">{children}</dd>
    </div>
  )
}

export default function ExpandedDetailsGrid({ items = [], children, columns = 'sm:grid-cols-2 lg:grid-cols-4' }) {
  return (
    <dl className={`grid grid-cols-1 gap-x-5 gap-y-3 ${columns}`}>
      {items.map((item) => (
        <ExpandedDetail key={item.label} label={item.label} className={item.className}>{item.value}</ExpandedDetail>
      ))}
      {children}
    </dl>
  )
}
