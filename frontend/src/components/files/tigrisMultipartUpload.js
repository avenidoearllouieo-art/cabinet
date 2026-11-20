import api from '../../services/api.js'

const PART_CONCURRENCY = 4
const PART_RETRIES = 3
const CONTROL_REQUEST_TIMEOUT = 30_000
const PART_REQUEST_TIMEOUT = 5 * 60_000
const COMPLETE_REQUEST_TIMEOUT = 60_000

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError')
}

function putPart(url, blob, { signal, onProgress, requestId }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const cleanup = () => signal?.removeEventListener('abort', abortRequest)
    const abortRequest = () => request.abort()
    const rejectUpload = (message) => {
      const error = new Error(message)
      error.name = 'TigrisUploadError'
      error.status = request.status || null
      error.requestId = requestId || 'unavailable'
      reject(error)
    }

    request.open('PUT', url)
    request.withCredentials = false
    request.timeout = PART_REQUEST_TIMEOUT
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded)
    }
    request.onerror = () => {
      cleanup()
      rejectUpload('Network error while uploading a video part.')
    }
    request.onabort = () => {
      cleanup()
      const error = new DOMException('Upload cancelled.', 'AbortError')
      error.requestId = requestId || 'unavailable'
      reject(error)
    }
    request.ontimeout = () => {
      cleanup()
      rejectUpload('The video part upload timed out.')
    }
    request.onload = () => {
      cleanup()
      if (request.status < 200 || request.status >= 300) {
        rejectUpload(`Tigris rejected video part (${request.status}).`)
        return
      }
      const etag = request.getResponseHeader('ETag')
      if (!etag) {
        rejectUpload('Tigris did not return the ETag required to complete the upload. Check bucket CORS ExposeHeaders.')
        return
      }
      resolve(etag)
    }

    if (signal?.aborted) {
      cleanup()
      reject(new DOMException('Upload cancelled.', 'AbortError'))
      return
    }
    signal?.addEventListener('abort', abortRequest, { once: true })
    request.send(blob)
  })
}

function retryDelay(attempt, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'))
      return
    }
    const cleanup = () => signal?.removeEventListener('abort', abortRetry)
    const timeout = window.setTimeout(() => {
      cleanup()
      resolve()
    }, 400 * (2 ** attempt))
    const abortRetry = () => {
      window.clearTimeout(timeout)
      cleanup()
      reject(new DOMException('Upload cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', abortRetry, { once: true })
  })
}

async function abortSession(sessionId) {
  try {
    await api.post(`/student/multipart-uploads/${sessionId}/abort/`, {}, { timeout: 15_000 })
  } catch {
    // Expired or already-completed sessions are handled by server-side cleanup.
  }
}

export async function uploadTigrisVideo(file, activityId, { signal, onProgress = () => {} } = {}) {
  throwIfAborted(signal)
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  signal?.addEventListener('abort', abortFromCaller, { once: true })
  const uploadSignal = controller.signal
  let start
  try {
    start = await api.post('/student/multipart-uploads/', {
      activity: activityId,
      filename: file.name,
      file_size: file.size,
    }, { signal: uploadSignal, timeout: CONTROL_REQUEST_TIMEOUT })
  } catch (error) {
    signal?.removeEventListener('abort', abortFromCaller)
    throw error
  }
  const sessionId = start.data.upload_id
  const partSize = Number(start.data.part_size)
  const totalParts = Number(start.data.total_parts)
  if (!sessionId || !Number.isSafeInteger(partSize) || partSize <= 0 || !Number.isSafeInteger(totalParts) || totalParts < 1) {
    if (sessionId) await abortSession(sessionId)
    signal?.removeEventListener('abort', abortFromCaller)
    throw new Error('The server returned an invalid multipart upload session.')
  }

  const partsByNumber = new Map()
  const progressByPart = new Map()
  let nextPartNumber = 1
  const reportProgress = () => {
    const loaded = [...progressByPart.values()].reduce((sum, value) => sum + value, 0)
    onProgress(Math.min(100, Math.round((loaded / file.size) * 100)))
  }

  const worker = async () => {
    while (true) {
      throwIfAborted(uploadSignal)
      const partNumber = nextPartNumber
      nextPartNumber += 1
      if (partNumber > totalParts) return

      const startByte = (partNumber - 1) * partSize
      const endByte = Math.min(file.size, startByte + partSize)
      const chunk = file.slice(startByte, endByte)
      let succeeded = false

      for (let attempt = 0; attempt < PART_RETRIES; attempt += 1) {
        throwIfAborted(uploadSignal)
        progressByPart.set(partNumber, 0)
        reportProgress()
        try {
          const signed = await api.post(
            `/student/multipart-uploads/${sessionId}/parts/${partNumber}/`,
            {},
            { signal: uploadSignal, timeout: CONTROL_REQUEST_TIMEOUT },
          )
          const etag = await putPart(signed.data.url, chunk, {
            signal: uploadSignal,
            requestId: signed.headers?.['x-request-id'] || signed.data?.request_id,
            onProgress: (loaded) => {
              progressByPart.set(partNumber, Math.min(loaded, chunk.size))
              reportProgress()
            },
          })
          partsByNumber.set(partNumber, { part_number: partNumber, etag })
          progressByPart.set(partNumber, chunk.size)
          reportProgress()
          succeeded = true
          break
        } catch (error) {
          if (uploadSignal.aborted || error.name === 'AbortError') throw error
          if (attempt === PART_RETRIES - 1) throw error
          await retryDelay(attempt, uploadSignal)
        }
      }
      if (!succeeded) throw new Error(`Video part ${partNumber} could not be uploaded.`)
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, totalParts) }, worker))
    throwIfAborted(uploadSignal)
    const parts = [...partsByNumber.values()].sort((left, right) => left.part_number - right.part_number)
    let completed
    try {
      completed = await api.post(`/student/multipart-uploads/${sessionId}/complete/`, { parts }, {
        signal: uploadSignal,
        timeout: COMPLETE_REQUEST_TIMEOUT,
      })
    } catch (error) {
      if (uploadSignal.aborted || (error.response && error.response.status < 500)) throw error
      completed = await api.post(`/student/multipart-uploads/${sessionId}/complete/`, { parts }, {
        signal: uploadSignal,
        timeout: COMPLETE_REQUEST_TIMEOUT,
      })
    }
    onProgress(100)
    return { ...completed.data, source: 'temp', tempUploadId: completed.data.temp_upload_id }
  } catch (error) {
    controller.abort()
    await abortSession(sessionId)
    throw error
  } finally {
    signal?.removeEventListener('abort', abortFromCaller)
  }
}
