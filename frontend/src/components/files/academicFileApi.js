import api from '../../services/api.js'

function resolveFileUrl(path) {
  if (!path) return ''
  const baseURL = api.defaults?.baseURL || window.location.origin
  let origin
  try {
    origin = new URL(baseURL, window.location.origin).origin
  } catch {
    origin = window.location.origin
  }
  return new URL(path, origin).toString()
}

export async function authorizeAcademicFile(kind, attachmentId) {
  const response = await api.post(
    `/file-previews/${kind}/${attachmentId}/authorize/`,
    {},
    { withCredentials: true },
  )
  return {
    ...response.data,
    content_url: resolveFileUrl(response.data.content_url),
    download_url: resolveFileUrl(response.data.download_url),
  }
}

export function downloadAuthorizedFile(file) {
  const link = document.createElement('a')
  link.href = file.download_url
  link.download = file.filename || 'download'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}