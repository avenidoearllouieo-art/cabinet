export default function TableSkeleton() {
  return (
    <div className="w-full bg-white rounded-xl border border-slate-100 shadow-sm p-4 mt-6">
      <div className="animate-pulse">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="h-10 w-64 rounded-xl bg-slate-100" />
            <div className="h-10 w-32 rounded-xl bg-slate-100" />
          </div>

          <div className="mb-2 h-8 w-full rounded-lg bg-slate-50" />

          <div className="flex flex-col">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="flex min-h-14 items-center gap-4 border-b border-slate-100 py-3"
              >
                <div className="h-10 w-10 shrink-0 rounded-full bg-slate-100" />
                <div className="h-4 w-32 rounded bg-slate-100" />
                <div className="h-4 w-48 rounded bg-slate-100" />
                <div className="ml-auto h-6 w-20 rounded-full bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
