import { BadgeCheck } from 'lucide-react'

export default function ProfileSummaryCard({ imageUrl, fullName, initials, role, identity = [], facts = [], action }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 sm:h-28 sm:w-28">
          {imageUrl ? (
            <img src={imageUrl} alt={`${fullName} profile`} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#eaf0f6] text-3xl font-bold text-[#0B2A4A]">{initials || 'U'}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-bold text-[#0B2A4A] sm:text-2xl">{fullName}</h2>
              <span className="mt-2 inline-flex min-h-7 items-center gap-1.5 rounded-full bg-[#eef4fa] px-3 py-1 text-xs font-semibold text-[#0B2A4A]">
                <BadgeCheck size={14} />{role}
              </span>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
                {identity.map(({ label, value }) => (
                  <p key={label}>{label} <span className="font-semibold text-slate-700">{value || 'Not recorded'}</span></p>
                ))}
              </div>
            </div>
            {action && <div className="shrink-0">{action}</div>}
          </div>
          <dl className="mt-5 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
            {facts.map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex min-w-0 items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                {Icon && <Icon size={17} className="mt-0.5 shrink-0 text-[#0B2A4A]" />}
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="mt-1 break-words text-sm font-semibold text-slate-800">{value || 'Not recorded'}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}