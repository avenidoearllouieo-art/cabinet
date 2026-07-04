import { useState, useRef } from 'react'
import { Upload, X, FileText, Eye } from 'lucide-react'
import api from '../../services/api.js'
import Modal from '../Modal.jsx'

const ALLOWED_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'image/jpeg', 'image/png']
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.zip', '.jpg', '.jpeg', '.png']
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

function getFileExtension(filename) {
  return filename.substring(filename.lastIndexOf('.')).toLowerCase()
}

function isFileTypeAllowed(file) {
  return ALLOWED_TYPES.includes(file.type) || ALLOWED_EXTENSIONS.includes(getFileExtension(file.name))
}

function formatBytes(bytes) {
  if (bytes == null) return '—'
  const kb = 1024
  if (bytes < kb) return `${bytes} B`
  const mb = kb * 1024
  if (bytes < mb) return `${(bytes / kb).toFixed(1)} KB`
  return `${(bytes / mb).toFixed(1)} MB`
}

export default function SubmitActivityModal({ activity, isOpen, onClose, onSuccess }) {
  const [files, setFiles] = useState([])
  const [comments, setComments] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState([])
  const fileInputRef = useRef(null)

  if (!activity) return null

  const isOverdue = activity.due_date && new Date(activity.due_date) < new Date()
  const canSubmit = !isOverdue || activity.allow_late_submission

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files || [])
    const newErrors = []

    selectedFiles.forEach((file) => {
      if (!isFileTypeAllowed(file)) {
        newErrors.push(`${file.name}: File type not allowed. Use PDF, DOCX, PPTX, ZIP, JPG, JPEG, or PNG.`)
      } else if (file.size > MAX_FILE_SIZE) {
        newErrors.push(`${file.name}: File size exceeds 20 MB limit (${formatBytes(file.size)}).`)
      } else if (!files.find((f) => f.name === file.name)) {
        setFiles((prev) => [...prev, file])
      } else {
        newErrors.push(`${file.name}: File already added.`)
      }
    })

    setErrors(newErrors)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrors([])

    if (files.length === 0) {
      setErrors(['Please select at least one file to submit.'])
      return
    }

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('activity', activity.id)
      formData.append('remarks', comments)

      files.forEach((file) => {
        formData.append('file', file)
      })

      await api.post('/submissions/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      setFiles([])
      setComments('')
      onSuccess?.()
      onClose?.()
    } catch (err) {
      const errorData = err.response?.data
      if (typeof errorData === 'object') {
        setErrors([
          Object.entries(errorData)
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
            .join('\n'),
        ])
      } else {
        setErrors(['Failed to submit activity. Please try again.'])
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Submit Activity">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Activity Info */}
        <div className="rounded-[12px] border border-[#E5E7EB] bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-500">Activity</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{activity.title}</p>
          {activity.due_date && (
            <p className={`mt-2 text-sm ${isOverdue ? 'text-orange-600 font-semibold' : 'text-slate-600'}`}>
              Due: {new Date(activity.due_date).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
              {isOverdue && ' (OVERDUE)'}
            </p>
          )}
        </div>

        {isOverdue && !activity.allow_late_submission && (
          <div className="rounded-[12px] border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-700">⚠️ This activity is overdue and late submissions are not allowed.</p>
          </div>
        )}

        {/* File Upload */}
        <div className="space-y-4">
          <label className="block">
            <p className="mb-2 text-sm font-semibold text-slate-900">Attach Files</p>
            <div className="relative rounded-[12px] border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center transition hover:border-blue-400">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                disabled={loading || !canSubmit}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || !canSubmit}
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-400"
              >
                <Upload size={18} /> Choose Files
              </button>
              <p className="mt-3 text-xs text-slate-500">PDF, DOCX, PPTX, ZIP, JPG, JPEG, PNG • Max 20 MB per file</p>
            </div>
          </label>

          {/* Files Preview */}
          {files.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">{files.length} file(s) selected</p>
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-3">
                    <FileText size={20} className="text-slate-400" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{file.name}</p>
                      <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(index)}
                    className="rounded-full p-2 transition hover:bg-red-50"
                  >
                    <X size={18} className="text-red-600" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comments */}
        <div className="space-y-4">
          <label className="block">
            <p className="mb-2 text-sm font-semibold text-slate-900">Comments (Optional)</p>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Add any comments or notes about your submission..."
              disabled={loading}
              rows={4}
              className="w-full rounded-[12px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
            />
          </label>
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="space-y-2 rounded-[12px] border border-red-200 bg-red-50 p-4">
            {errors.map((error, i) => (
              <p key={i} className="text-sm text-red-700">
                • {error}
              </p>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4 border-t border-slate-200 pt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-full border border-slate-200 bg-white px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !canSubmit || files.length === 0}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-400"
          >
            {loading ? 'Submitting...' : (
              <>
                <Upload size={18} /> Submit
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
