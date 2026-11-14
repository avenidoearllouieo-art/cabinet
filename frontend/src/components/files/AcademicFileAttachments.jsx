import { useState } from 'react'
import { Download, Eye, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, File as FileIcon } from 'lucide-react'
import FilePreviewModal from './FilePreviewModal.jsx'
import { authorizeAcademicFile, downloadAuthorizedFile } from './academicFileApi.js'

function attachmentName(attachment) {
  const rawName = attachment?.filename || attachment?.file_name || attachment?.name || attachment?.file || 'Attachment'
  return String(rawName).split(/[\\/]/).pop() || 'Attachment'
}

function fileCategory(attachment) {
  const contentType = String(attachment?.content_type || attachment?.mime_type || '').toLowerCase()
  const name = attachmentName(attachment).toLowerCase()
  const extension = name.split('.').pop()
  if (contentType.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(extension)) return 'Video'
  if (contentType.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(extension)) return 'Audio'
  if (contentType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'Image'
  if (contentType === 'application/pdf' || extension === 'pdf') return 'PDF'
  if (['doc', 'docx', 'odt'].includes(extension)) return 'Document'
  if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) return 'Spreadsheet'
  if (['ppt', 'pptx', 'odp'].includes(extension)) return 'Presentation'
  return 'File'
}

function FileTypeIcon({ category }) {
  const Icon = category === 'Video' ? FileVideo
    : category === 'Audio' ? FileAudio
      : category === 'Image' ? FileImage
        : category === 'Spreadsheet' ? FileSpreadsheet
          : category === 'PDF' || category === 'Document' || category === 'Presentation' ? FileText
            : FileIcon
  return <Icon size={20} className="shrink-0 text-[#28415f]" aria-hidden="true" />
}

function formatBytes(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export default function AcademicFileAttachments({ attachments = [], kind, emptyMessage = 'No attachments available.' }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)
  const [downloadErrors, setDownloadErrors] = useState({})

  const handleDownload = async (attachment, fileKind) => {
    const id = attachment?.id
    if (id == null) {
      setDownloadErrors((current) => ({ ...current, [attachmentName(attachment)]: 'File unavailable.' }))
      return
    }
    setDownloadingId(id)
    setDownloadErrors((current) => ({ ...current, [id]: '' }))
    try {
      const file = await authorizeAcademicFile(fileKind, id)
      downloadAuthorizedFile(file)
    } catch {
      setDownloadErrors((current) => ({ ...current, [id]: 'File unavailable. It may have been moved or deleted.' }))
    } finally {
      setDownloadingId(null)
    }
  }

  if (!attachments.length) return <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">{emptyMessage}</p>

  return (
    <>
      <ul className="space-y-2">
        {attachments.map((attachment, index) => {
          const fileKind = attachment.preview_kind || kind
          const category = fileCategory(attachment)
          const size = formatBytes(attachment.size ?? attachment.file_size)
          const id = attachment.id ?? `${attachmentName(attachment)}-${index}`
          const actionId = attachment.id ?? attachmentName(attachment)
          return (
            <li key={id} className="rounded-lg border border-slate-200 bg-white px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileTypeIcon category={category} />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-800">{attachmentName(attachment)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{category}{size ? ` · ${size}` : ''}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedFile({ attachment, kind: fileKind })}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-[#0B1F3A] hover:bg-slate-50"
                  >
                    <Eye size={15} /> Open File
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(attachment, fileKind)}
                    disabled={downloadingId === attachment.id}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#0B1F3A] px-3 text-sm font-semibold text-white hover:bg-[#173d68] disabled:opacity-60"
                  >
                    <Download size={15} /> {downloadingId === attachment.id ? 'Preparing…' : 'Download'}
                  </button>
                </div>
              </div>
              {downloadErrors[actionId] && <p className="mt-2 text-sm text-rose-700" role="alert">{downloadErrors[actionId]}</p>}
            </li>
          )
        })}
      </ul>
      {selectedFile && (
        <FilePreviewModal
          attachment={selectedFile.attachment}
          kind={selectedFile.kind}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </>
  )
}