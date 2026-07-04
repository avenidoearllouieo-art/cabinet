export default function StatCard({ icon, label, value, subtitle }) {
  return (
    <div className="min-h-[160px] rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#DBEAFE] text-xl">
          {icon}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-[#6B7280]">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-[#111827]">{value}</p>
        {subtitle && <p className="mt-1 text-xs text-[#6B7280]">{subtitle}</p>}
      </div>
    </div>
  )
}
