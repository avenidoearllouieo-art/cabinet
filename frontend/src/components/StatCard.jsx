import SummaryCard from './SummaryCard'

export default function StatCard({
  icon,
  label,
  value,
  subtitle,
  trend,
  bgColor = 'bg-blue-50',
  textColor = 'text-blue-900',
}) {
  const trendColor = trend?.direction === 'up'
    ? 'text-emerald-700'
    : trend?.direction === 'down'
      ? 'text-rose-700'
      : 'text-slate-500'

  return (
    <SummaryCard
      title={label}
      value={value}
      icon={icon}
      trendText={trend?.label || subtitle}
      trendColor={trendColor}
      iconBg={bgColor}
      iconColor={textColor}
    />
  )
}
