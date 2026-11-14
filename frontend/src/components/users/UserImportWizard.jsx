import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Download, FileSpreadsheet, FileText, Upload, X } from 'lucide-react'
import api from '../../services/api.js'
import { FormDialog } from '../forms/FormPrimitives.jsx'

const steps = ['Choose Type', 'Upload File', 'Preview & Validate', 'Confirm Import', 'Results']
const maxFileSize = 10 * 1024 * 1024

function formatError(data) {
  if (typeof data?.detail === 'string') return data.detail
  if (typeof data?.file?.[0] === 'string') return data.file[0]
  if (typeof data?.role?.[0] === 'string') return data.role[0]
  if (Array.isArray(data?.errors) && data.errors.length) return data.errors.map((error) => error.message).join(' ')
  return 'The import request failed. Check the file and try again.'
}

export default function UserImportWizard({ isOpen, onClose, onImported }) {
  const [step, setStep] = useState(0)
  const [role, setRole] = useState('student')
  const [fileFormat, setFileFormat] = useState('xlsx')
  const [files, setFiles] = useState([])
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setStep(0)
    setRole('student')
    setFileFormat('xlsx')
    setFiles([])
    setPreview(null)
    setResult(null)
    setError('')
  }, [isOpen])

  const chooseFiles = (selectedFiles, inputElement) => {
    const accepted = []
    const errors = []
    for (const selected of selectedFiles) {
      const extension = selected.name.split('.').pop()?.toLowerCase()
      if (!['xlsx', 'csv'].includes(extension)) {
        errors.push(`${selected.name}: choose an .xlsx or .csv file.`)
      } else if (selected.size > maxFileSize) {
        errors.push(`${selected.name}: the file must be 10 MB or smaller.`)
      } else {
        accepted.push(selected)
      }
    }
    if (accepted.length) {
      setFiles((current) => {
        const seen = new Set(current.map((item) => `${item.name}:${item.size}:${item.lastModified}`))
        return [...current, ...accepted.filter((item) => {
          const key = `${item.name}:${item.size}:${item.lastModified}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })]
      })
      setPreview(null)
      setResult(null)
    }
    setError(errors.join(' '))
    if (inputElement) inputElement.value = ''
  }

  const handleFileSelect = (event) => {
    chooseFiles(Array.from(event.target.files || []), event.target)
  }

  const handleDrop = (event) => {
    event.preventDefault()
    chooseFiles(Array.from(event.dataTransfer?.files || []))
  }

  const removeFile = (fileToRemove) => {
    setFiles((current) => current.filter((file) => file !== fileToRemove))
    setPreview(null)
    setResult(null)
    setError('')
  }

  const downloadTemplate = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/users/import/template/', {
        params: { role, file_format: fileFormat },
        responseType: 'blob',
      })
      const blobUrl = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `${role}-import-template.${fileFormat}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
    } catch (requestError) {
      setError(formatError(requestError.response?.data))
    } finally {
      setLoading(false)
    }
  }

  const uploadForPreview = async () => {
    if (!files.length) {
      setError('Choose at least one file to preview.')
      return
    }
    setLoading(true)
    setError('')
    const body = new FormData()
    body.append('role', role)
    files.forEach((file) => body.append('files', file))
    try {
      const response = await api.post('/users/import/preview/', body)
      setPreview(response.data)
      setStep(2)
    } catch (requestError) {
      const data = requestError.response?.data
      if (data && Array.isArray(data.rows)) {
        setPreview(data)
        setStep(2)
      } else {
        setError(formatError(data))
      }
    } finally {
      setLoading(false)
    }
  }

  const confirmImport = async () => {
    if (!files.length || !preview?.valid_rows || blockingPreviewErrors.length > 0) return
    setLoading(true)
    setError('')
    const body = new FormData()
    body.append('role', role)
    files.forEach((file) => body.append('files', file))
    try {
      const response = await api.post('/users/import/confirm/', body)
      setResult(response.data)
      setStep(4)
      if (response.data.successfully_imported > 0) onImported?.(response.data)
    } catch (requestError) {
      const data = requestError.response?.data
      if (data && Object.hasOwn(data, 'successfully_imported')) {
        setResult(data)
        setStep(4)
      } else {
        setError(formatError(data))
      }
    } finally {
      setLoading(false)
    }
  }

  const requestClose = () => {
    if (loading) return
    if (files.length && step < 4 && !window.confirm('Discard this import preview?')) return
    onClose?.()
  }

  const blockingPreviewErrors = (preview?.errors || []).filter((item) => !Number.isInteger(Number(item.row)))
  const canContinue = step === 0 || (step === 1 && files.length > 0) || (step === 2 && Boolean(preview?.valid_rows) && blockingPreviewErrors.length === 0)

  return (
    <FormDialog
      isOpen={isOpen}
      title="Import Users"
      description="Add students or instructors from validated spreadsheets."
      headerIcon={<FileSpreadsheet size={20} />}
      headerClassName="border-[#082B53] bg-[#082B53]"
      titleClassName="text-white"
      descriptionClassName="text-[#EAF2FB]"
      closeButtonClassName="border-white/30 text-white hover:bg-white/10 hover:text-white focus:ring-[#FFBE0B]"
      onClose={requestClose}
      dirty={false}
      busy={loading}
      asForm={false}
      maxWidth="max-w-5xl"
      stepper={(
        <nav aria-label="Import progress" className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
          <p className="text-sm font-semibold text-[#082B53] sm:hidden">Step {step + 1} of 5: {steps[step]}</p>
          <ol className="hidden items-center gap-2 sm:flex">
            {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} className={`flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold ${index === step ? 'text-[#082B53]' : index < step ? 'text-emerald-700' : 'text-slate-500'}`}><span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${index === step ? 'bg-[#082B53] text-white ring-2 ring-[#FFBE0B]' : index < step ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-500 ring-1 ring-slate-300'}`}>{index < step ? <CheckCircle2 size={15} /> : index + 1}</span><span className="truncate">{label}</span>{index < steps.length - 1 && <span className={`ml-auto h-px flex-1 ${index < step ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden="true" />}</li>)}
          </ol>
        </nav>
      )}
      actions={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={requestClose} disabled={loading} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">{step === 4 ? 'Close' : 'Cancel'}</button>
            {step > 0 && step < 4 && <button type="button" onClick={() => { setError(''); setStep((current) => current - 1) }} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"><ArrowLeft size={16} />Back</button>}
          </div>
          <div>
            {step === 0 && <button type="button" onClick={() => setStep(1)} disabled={!canContinue || loading} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#FFBE0B] px-5 py-2 text-sm font-bold text-[#082B53] disabled:cursor-not-allowed disabled:opacity-50">Continue<ArrowRight size={16} /></button>}
            {step === 2 && <button type="button" onClick={() => setStep(3)} disabled={!canContinue || loading} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#FFBE0B] px-5 py-2 text-sm font-bold text-[#082B53] disabled:cursor-not-allowed disabled:opacity-50">Continue<ArrowRight size={16} /></button>}
            {step === 3 && <button type="button" onClick={confirmImport} disabled={!files.length || !preview?.valid_rows || blockingPreviewErrors.length > 0 || loading} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#FFBE0B] px-5 py-2 text-sm font-bold text-[#082B53] disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Importing...' : 'Confirm Import'}</button>}
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

        {step === 0 && (
          <section aria-labelledby="import-user-type" className="space-y-3">
            <h3 id="import-user-type" className="text-base font-semibold text-[#082B53]">Choose user type</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {[['student', 'Import Students'], ['instructor', 'Import Instructors']].map(([value, label]) => (
                <button key={value} type="button" aria-pressed={role === value} onClick={() => setRole(value)} className={`flex min-h-20 items-center gap-3 rounded-lg border p-4 text-left font-semibold ${role === value ? 'border-[#082B53] bg-[#EAF2FB] text-[#082B53]' : 'border-slate-200 bg-white text-slate-700'}`}>
                  {value === 'student' ? <FileText size={20} /> : <FileSpreadsheet size={20} />}{label}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4">
            <h3 className="text-base font-semibold text-[#082B53]">Upload {role === 'student' ? 'Student' : 'Instructor'} file</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm font-semibold text-slate-700">Template format
                <select value={fileFormat} onChange={(event) => setFileFormat(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3">
                  <option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option>
                </select>
              </label>
              <button type="button" onClick={downloadTemplate} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-[#082B53] disabled:opacity-50"><Download size={16} />Download Template</button>
            </div>
            <div onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} className="flex min-h-32 flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#9AB7D5] bg-[#EAF2FB] p-5 text-center">
              <Upload size={20} className="text-[#082B53]" />
              <p className="mt-2 text-sm font-semibold text-[#082B53]">Drop spreadsheets here or add files</p>
              <p className="mt-1 text-xs text-slate-600">Excel or CSV, up to 10 MB per file</p>
              <input ref={fileInputRef} type="file" accept=".xlsx,.csv" multiple className="sr-only" onChange={handleFileSelect} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#082B53] bg-white px-4 text-sm font-semibold text-[#082B53] disabled:opacity-50"><Upload size={16} />Add Files</button>
            </div>
            {files.length > 0 && <ul aria-label="Selected import files" className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {files.map((file) => <li key={`${file.name}:${file.size}:${file.lastModified}`} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5"><div className="flex min-w-0 items-center gap-2"><FileText size={17} className="shrink-0 text-[#082B53]" /><span className="break-all text-sm font-medium text-slate-800">{file.name}</span><span className="shrink-0 text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</span></div><button type="button" onClick={() => removeFile(file)} aria-label={`Remove ${file.name}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-rose-700 hover:bg-rose-50"><X size={17} /></button></li>)}
            </ul>}
            <button type="button" onClick={uploadForPreview} disabled={!files.length || loading} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#FFBE0B] px-4 text-sm font-bold text-[#082B53] disabled:opacity-50">{loading ? 'Validating...' : 'Continue'}<ArrowRight size={16} /></button>
          </section>
        )}

        {step === 2 && preview && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Total rows', preview.total_rows], ['Valid rows', preview.valid_rows],
                ['Invalid rows', preview.invalid_rows], ['Duplicate rows', preview.duplicate_rows],
              ].map(([label, count]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-[#082B53]">{count}</p></div>)}
            </div>
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-[#EAF2FB] text-xs uppercase text-[#082B53]"><tr><th className="p-3">File / row</th><th className="p-3">Full name</th><th className="p-3">{role === 'student' ? 'Student ID' : 'Instructor ID'}</th><th className="p-3">Section(s)</th><th className="p-3">Validation</th><th className="p-3">Error message</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.rows.map((row) => <tr key={row.row_number}><td className="max-w-48 break-all p-3"><span className="block">{row.file || '—'}</span><span className="text-xs text-slate-500">Row {row.source_row_number || row.row_number}</span></td><td className="p-3">{row.full_name || '—'}</td><td className="p-3">{row.identifier || '—'}</td><td className="p-3">{row.sections.join(', ') || '—'}</td><td className={`p-3 font-semibold ${row.validation_status === 'Valid' ? 'text-emerald-700' : row.validation_status === 'Duplicate' ? 'text-amber-700' : 'text-rose-700'}`}>{row.validation_status}</td><td className="p-3 text-xs text-rose-700">{row.error_message || '—'}</td></tr>)}
                  {!preview.rows.length && <tr><td className="p-4 text-center text-slate-500" colSpan={6}>No data rows to preview.</td></tr>}
                </tbody>
              </table>
            </div>
            {blockingPreviewErrors.length > 0 && <ul role="alert" className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{blockingPreviewErrors.map((item, index) => <li key={`${item.file}-${index}`}>{item.file ? `${item.file}: ` : ''}{item.message}</li>)}</ul>}
          </section>
        )}

        {step === 3 && preview && (
          <section className="space-y-4">
            <h3 className="text-base font-semibold text-[#082B53]">Confirm {role === 'student' ? 'Student' : 'Instructor'} import</h3>
            <p className="text-sm leading-6 text-slate-700">All selected files will be revalidated together. Existing accounts will not be overwritten; invalid and duplicate rows will be skipped.</p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ImportCount label="Valid" value={preview.valid_rows} />
              <ImportCount label="Skipped" value={preview.invalid_rows + preview.duplicate_rows} />
              <ImportCount label="Passwords" value="Unusable" />
              <ImportCount label="NFC UIDs" value="Unchanged" />
            </dl>
          </section>
        )}

        {step === 4 && result && (
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-base font-semibold text-[#082B53]"><CheckCircle2 size={20} className="text-emerald-700" />Import Results</h3>
            <dl className="grid grid-cols-3 gap-3">
              <ImportCount label="Successfully imported" value={result.successfully_imported ?? 0} />
              <ImportCount label="Skipped" value={result.skipped ?? 0} />
              <ImportCount label="Failed" value={result.failed ?? 0} />
            </dl>
            {result.errors?.length > 0 && <ul className="max-h-48 space-y-2 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{result.errors.map((item, index) => <li key={`${item.row}-${item.column}-${index}`}>Row {item.row}, {item.column}: {item.message}</li>)}</ul>}
            <p className="text-sm text-slate-600">Click Close to return to Users Management and refresh the directory.</p>
          </section>
        )}
      </div>
    </FormDialog>
  )
}

function ImportCount({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-lg font-bold text-[#082B53]">{value}</dd></div>
}
