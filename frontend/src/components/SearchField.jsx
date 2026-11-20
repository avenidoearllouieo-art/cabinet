import { Search, X } from 'lucide-react'

export default function SearchField({
  value,
  onChange,
  onClear,
  placeholder,
  ariaLabel,
  clearLabel = 'Clear search',
  className = '',
  inputClassName = '',
}) {
  return (
    <label className={`relative block min-w-0 ${className}`}>
      <span className="pointer-events-none absolute inset-y-0 left-3 z-[1] flex items-center text-[#64748b]" aria-hidden="true">
        <Search size={16} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`tt-control tt-search-control w-full min-w-0 truncate ${inputClassName}`}
      />
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="absolute right-1 top-1/2 z-[1] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#082B53]"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </label>
  )
}