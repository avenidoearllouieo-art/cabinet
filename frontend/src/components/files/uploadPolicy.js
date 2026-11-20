const MIB = 1024 * 1024

export const MAX_STUDENT_SUBMISSION_FILES = 5
export const MAX_STUDENT_SUBMISSION_BYTES = 10 * 1024 * MIB
export const MAX_STUDENT_VIDEO_BYTES = 5 * 1024 * MIB
export const DIRECT_MULTIPART_THRESHOLD = 64 * MIB
export const SUPPORTED_UPLOAD_ACCEPT = '.mp4,.mov,.webm,.jpg,.jpeg,.png,.webp,.pdf,.docx,.pptx,.xlsx,.mp3,.wav'

const FILE_LIMITS = {
  mp4: { label: 'Video', bytes: 500 * MIB, studentBytes: MAX_STUDENT_VIDEO_BYTES },
  mov: { label: 'Video', bytes: 500 * MIB, studentBytes: MAX_STUDENT_VIDEO_BYTES },
  webm: { label: 'Video', bytes: 500 * MIB, studentBytes: MAX_STUDENT_VIDEO_BYTES },
  jpg: { label: 'Image', bytes: 20 * MIB },
  jpeg: { label: 'Image', bytes: 20 * MIB },
  png: { label: 'Image', bytes: 20 * MIB },
  webp: { label: 'Image', bytes: 20 * MIB },
  pdf: { label: 'Document', bytes: 25 * MIB },
  docx: { label: 'Document', bytes: 25 * MIB },
  pptx: { label: 'Document', bytes: 25 * MIB },
  xlsx: { label: 'Document', bytes: 25 * MIB },
  mp3: { label: 'Audio', bytes: 50 * MIB },
  wav: { label: 'Audio', bytes: 50 * MIB },
}

function fileSize(file) {
  const size = Number(file?.size ?? file?.file_size)
  return Number.isFinite(size) && size >= 0 ? size : 0
}

function fileName(file) {
  return String(file?.name || file?.filename || file?.file_name || 'Selected file')
    .replaceAll('\\', '/')
    .split('/')
    .pop()
}

export function validateUploadFiles(newFiles, { existingFiles = [], studentSubmission = false } = {}) {
  const errors = []
  for (const file of newFiles) {
    const name = fileName(file)
    const extension = name.split('.').pop()?.toLowerCase()
    const policy = FILE_LIMITS[extension]
    if (!policy) {
      errors.push(`${name}: unsupported format. Use MP4, MOV, WebM, JPG, JPEG, PNG, WebP, PDF, DOCX, PPTX, XLSX, MP3, or WAV.`)
      continue
    }
    const maximumBytes = studentSubmission ? policy.studentBytes || policy.bytes : policy.bytes
    if (fileSize(file) > maximumBytes) {
      const maximum = maximumBytes >= 1024 * MIB
        ? `${maximumBytes / (1024 * MIB)} GB`
        : `${maximumBytes / MIB} MB`
      errors.push(`${name}: ${policy.label} files must be ${maximum} or smaller.`)
    }
  }

  if (studentSubmission) {
    const allFiles = [...existingFiles, ...newFiles]
    if (allFiles.length > MAX_STUDENT_SUBMISSION_FILES) {
      errors.push(`A submission can contain at most ${MAX_STUDENT_SUBMISSION_FILES} files.`)
    }
    if (allFiles.reduce((total, file) => total + fileSize(file), 0) > MAX_STUDENT_SUBMISSION_BYTES) {
      errors.push('Combined submission files must not exceed 10 GB.')
    }
  }
  return errors
}

export function uploadErrorMessages(error, fallback) {
  const data = error?.response?.data
  if (!data) return [fallback]
  const preferred = data.files || data.file || data.attachments || data.detail || data.non_field_errors || data
  const collect = (value) => {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap(collect)
    if (value && typeof value === 'object') return Object.values(value).flatMap(collect)
    return []
  }
  const messages = collect(preferred).filter(Boolean)
  return messages.length ? messages : [fallback]
}
