import { CheckCircle2, Info, X } from 'lucide-react'

const headerTones = {
  navy: {
    header: 'border-b border-[#082B53] bg-[#082B53]',
    title: 'text-white',
    description: 'text-[#EAF2FB]',
    close: 'border-white/30 text-white hover:bg-white/10 hover:text-white focus:ring-[#FFBE0B]',
  },
  light: {
    header: 'border-b border-slate-200 bg-white',
    title: 'text-[#082B53]',
    description: 'text-slate-600',
    close: 'border-slate-200 text-slate-600 hover:bg-slate-100 focus:ring-[#FFBE0B]',
  },
}

export function ModalHeader({
  title,
  description,
  icon = <Info size={20} aria-hidden="true" />,
  onClose,
  busy = false,
  tone = 'navy',
  closeLabel = 'Close dialog',
  actions,
  className = '',
  titleClassName = '',
  descriptionClassName = '',
  closeButtonClassName = '',
  closeSizeClassName = 'h-11 w-11 rounded-lg',
  closeRef,
  titleId,
}) {
  const styles = headerTones[tone] || headerTones.navy

  return (
    <header className={`sticky top-0 z-20 flex shrink-0 items-start justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6 ${styles.header} ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#FFBE0B] text-[#082B53]">{icon}</span>}
        <div className="min-w-0">
          <h2 id={titleId} title={title} className={`break-words text-xl font-bold sm:text-2xl ${styles.title} ${titleClassName}`}>{title}</h2>
          {description && <p className={`mt-1 break-words text-sm ${styles.description} ${descriptionClassName}`}>{description}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {onClose && (
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            disabled={busy}
            className={`flex shrink-0 items-center justify-center border transition focus:outline-none focus:ring-2 disabled:opacity-50 ${closeSizeClassName} ${styles.close} ${closeButtonClassName}`}
            aria-label={closeLabel}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  )
}

export function ModalBody({ children, className = '' }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto ${className}`}>{children}</div>
}

export function ModalFooter({ children, className = '' }) {
  return <footer className={`sticky bottom-0 z-20 shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6 ${className}`}>{children}</footer>
}

export function ModalStepper({ steps, currentStep, ariaLabel = 'Dialog progress' }) {
  return (
    <nav aria-label={ariaLabel} className="shrink-0 border-b border-slate-200 bg-[#F3F6FA] px-4 py-3 sm:px-6">
      <p className="text-sm font-semibold text-[#082B53] sm:hidden">Step {currentStep + 1} of {steps.length}: {steps[currentStep]}</p>
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((step, index) => {
          const active = index === currentStep
          const complete = index < currentStep
          return (
            <li key={step} aria-current={active ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active ? 'bg-[#082B53] text-white ring-2 ring-[#FFBE0B]' : complete ? 'bg-emerald-100 text-emerald-800' : 'border border-slate-300 bg-white text-slate-500'}`}>
                {complete ? <CheckCircle2 className="h-4 w-4" aria-label="Complete" /> : index + 1}
              </span>
              <span className={`truncate text-xs font-semibold ${active ? 'text-[#082B53]' : complete ? 'text-emerald-800' : 'text-slate-500'}`}>{step}</span>
              {index < steps.length - 1 && <span className={`ml-auto h-px flex-1 ${complete ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}