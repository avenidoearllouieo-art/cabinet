import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileUp,
  LoaderCircle,
  X,
} from 'lucide-react'
import { controlClass } from './formStyles.js'

export function InlineFeedback({ type = 'error', children, className = '' }) {
  if (!children) return null
  const success = type === 'success'
  const Icon = success ? CheckCircle2 : AlertCircle
  return (
    <div
      role={success ? 'status' : 'alert'}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

export function FormField({ label, required = false, optional = false, helper, error, children, className = '' }) {
  const id = useId()
  const errorText = Array.isArray(error) ? error.join(' ') : error ? String(error) : ''
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-slate-700">
          {label}{required && <span className="ml-1 text-rose-600" aria-hidden="true">*</span>}
          {required && <span className="sr-only"> required</span>}
        </label>
        {optional && <span className="text-xs font-medium text-slate-500">Optional</span>}
      </div>
      {typeof children === 'function'
        ? children({ id, describedBy: errorText ? `${id}-error` : helper ? `${id}-help` : undefined, invalid: Boolean(errorText) })
        : children}
      {helper && !errorText && <p id={`${id}-help`} className="mt-1.5 text-xs leading-5 text-slate-500">{helper}</p>}
      {errorText && <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-rose-700">{errorText}</p>}
    </div>
  )
}

export function FormSection({ icon: Icon, title, description, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      <div className="mb-5 flex items-start gap-3">
        {Icon && <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-900"><Icon className="h-5 w-5" aria-hidden="true" /></div>}
        <div>
          <h3 className="text-base font-bold text-[#0B1F3A]">{title}</h3>
          {description && <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

export function FormStepper({ steps, currentStep }) {
  return (
    <nav aria-label="Form progress" className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
      <p className="text-sm font-semibold text-[#0B1F3A] sm:hidden">Step {currentStep + 1} of {steps.length}: {steps[currentStep]}</p>
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((step, index) => {
          const active = index === currentStep
          const complete = index < currentStep
          return (
            <li key={step} className="flex min-w-0 flex-1 items-center gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active ? 'bg-[#F5B700] text-[#0B1F3A]' : complete ? 'bg-[#0B1F3A] text-white' : 'border border-slate-300 bg-white text-slate-500'}`}>
                {complete ? <CheckCircle2 className="h-4 w-4" aria-label="Complete" /> : index + 1}
              </span>
              <span className={`truncate text-xs font-semibold ${active || complete ? 'text-[#0B1F3A]' : 'text-slate-500'}`}>{step}</span>
              {index < steps.length - 1 && <span className={`ml-auto h-px flex-1 ${complete ? 'bg-[#0B1F3A]' : 'bg-slate-300'}`} aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function LoadingSpinner({ label = 'Saving' }) {
  return <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /><span>{label}</span></>
}

export function FormDialog({
  isOpen,
  title,
  description,
  onClose,
  onSubmit,
  dirty = false,
  busy = false,
  children,
  stepper,
  actions,
  maxWidth = 'max-w-4xl',
  zIndex = 'z-[9999]',
}) {
  if (!isOpen) return null

  const requestClose = () => {
    if (busy) return
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    onClose?.()
  }

  return createPortal(
    <div className={`fixed inset-0 ${zIndex} flex items-center justify-center bg-slate-950/65 p-3 sm:p-4`} onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <form onSubmit={onSubmit} className={`flex max-h-[94vh] w-full ${maxWidth} flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-2xl`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-xl font-bold text-[#0B1F3A] sm:text-2xl">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={requestClose} disabled={busy} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:opacity-50" aria-label="Close dialog">
            <X className="h-5 w-5" />
          </button>
        </header>
        {stepper}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {actions && <footer className="sticky bottom-0 z-20 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">{actions}</footer>}
      </form>
    </div>,
    document.body,
  )
}

export function FormActions({ onCancel, onBack, onNext, isLastStep = false, submitLabel = 'Save', busy = false, disabled = false, destructiveAction, dirty = false }) {
  const requestCancel = () => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    onCancel?.()
  }
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>{destructiveAction}</div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <button type="button" onClick={requestCancel} disabled={busy} className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:opacity-50">Cancel</button>
        {onBack && <button type="button" onClick={onBack} disabled={busy} className="min-h-11 rounded-xl border border-slate-300 bg-slate-100 px-5 py-2.5 text-sm font-semibold text-[#0B1F3A] transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:opacity-50">Back</button>}
        {!isLastStep ? (
          <button type="button" onClick={onNext} disabled={busy || disabled} className="min-h-11 rounded-xl bg-[#F5B700] px-6 py-2.5 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:cursor-not-allowed disabled:opacity-50">Continue</button>
        ) : (
          <button type="submit" disabled={busy || disabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#F5B700] px-6 py-2.5 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <LoadingSpinner label="Saving…" /> : submitLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function PasswordField({ value, onChange, error, label = 'Password', required = false, helper, autoComplete = 'new-password', className = '' }) {
  const [visible, setVisible] = useState(false)
  return (
    <FormField label={label} required={required} helper={helper} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input id={id} type={visible ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid, 'pr-12')} />
          <button type="button" onClick={() => setVisible((current) => !current)} className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-900" aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      )}
    </FormField>
  )
}

export function FileUploadArea({ files = [], onChange, onRemove, multiple = true, accept, label = 'Choose files', helper = 'Supported files depend on your course requirements.', disabled = false }) {
  const inputRef = useRef(null)
  const formatSize = (bytes) => {
    if (!Number.isFinite(bytes)) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return (
    <div>
      <input ref={inputRef} type="file" multiple={multiple} accept={accept} onChange={onChange} disabled={disabled} className="sr-only" />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-[#F5B700] hover:bg-amber-50/40 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:opacity-50">
        <FileUp className="mb-2 h-6 w-6 text-blue-900" aria-hidden="true" />
        <span className="text-sm font-bold text-[#0B1F3A]">{label}</span>
        <span className="mt-1 text-xs text-slate-500">{helper}</span>
      </button>
      {files.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Selected files">
          {files.map((file, index) => (
            <li key={`${file.name || file.filename}-${file.size || index}`} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="min-w-0"><span className="block truncate font-semibold text-slate-700">{file.name || file.filename || file.file_name || 'Attachment'}</span><span className="text-xs text-slate-500">{formatSize(file.size || file.file_size)}</span></span>
              {onRemove && <button type="button" onClick={() => onRemove(file, index)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-600" aria-label={`Remove ${file.name || file.filename || 'file'}`}><X className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
