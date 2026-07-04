export default function PageHeader({ title, description, action }) {
  return (
    <div className="mb-8 flex items-center justify-between gap-4">
      <div>
        <h1 className="text-[32px] font-bold leading-tight text-[#111827]">{title}</h1>
        <p className="mt-1 text-[15px] text-[#6B7280]">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
