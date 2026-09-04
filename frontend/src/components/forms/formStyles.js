const baseControl = 'min-h-12 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-transparent focus:ring-2 focus:ring-blue-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 read-only:bg-slate-50'

export const controlClass = (error, extra = '') => `${baseControl} ${error ? 'border-rose-400 ring-1 ring-rose-200 focus:ring-rose-600' : 'border-slate-300'} ${extra}`
