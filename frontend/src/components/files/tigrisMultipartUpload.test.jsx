import { afterEach, describe, expect, it, vi } from 'vitest'
import api from '../../services/api.js'
import { uploadTigrisVideo } from './tigrisMultipartUpload.js'

vi.mock('../../services/api.js', () => ({ default: { post: vi.fn() } }))

class FakeXMLHttpRequest {
  static requests = []
  upload = {}
  status = 200
  responseHeaders = { ETag: '"part-etag"' }

  open(method, url) {
    this.method = method
    this.url = url
  }

  withCredentials = true

  getResponseHeader(name) {
    return this.responseHeaders[name] || null
  }

  send(body) {
    this.body = body
    FakeXMLHttpRequest.requests.push(this)
    this.upload.onprogress?.({ lengthComputable: true, loaded: body.size, total: body.size })
    queueMicrotask(() => this.onload?.())
  }

  abort() {
    this.onabort?.()
  }
}

describe('Tigris multipart video uploader', () => {
  afterEach(() => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
    FakeXMLHttpRequest.requests = []
  })

  it('retries failed parts with a new presign URL and completes in part order', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    const partAttempts = new Map()
    FakeXMLHttpRequest.prototype.send = function send(body) {
      this.body = body
      FakeXMLHttpRequest.requests.push(this)
      this.upload.onprogress?.({ lengthComputable: true, loaded: body.size, total: body.size })
      const partNumber = Number(this.url.match(/part-(\d+)/)[1])
      const attempt = (partAttempts.get(partNumber) || 0) + 1
      partAttempts.set(partNumber, attempt)
      if (partNumber === 2 && attempt === 1) this.status = 403
      queueMicrotask(() => this.onload?.())
    }
    const presignAttempts = new Map()
    api.post.mockImplementation((path) => {
      if (path === '/student/multipart-uploads/') {
        return Promise.resolve({ data: { upload_id: 'session-1', part_size: 4, total_parts: 2 } })
      }
      if (path.endsWith('/complete/')) return Promise.resolve({ data: { id: 8, temp_upload_id: 8 } })
      if (path.includes('/parts/')) {
        const partNumber = Number(path.match(/parts\/(\d+)/)[1])
        const attempt = (presignAttempts.get(partNumber) || 0) + 1
        presignAttempts.set(partNumber, attempt)
        return Promise.resolve({ data: { url: `https://private-bucket.t3.storage.dev/part-${partNumber}-attempt-${attempt}` } })
      }
      throw new Error(`Unexpected POST ${path}`)
    })

    const file = new File(['abcdefgh'], 'demo.mp4', { type: 'video/mp4' })
    const progress = vi.fn()
    const result = await uploadTigrisVideo(file, 31, { onProgress: progress })

    expect(result.temp_upload_id).toBe(8)
    expect(partAttempts.get(1)).toBe(1)
    expect(partAttempts.get(2)).toBe(2)
    expect(presignAttempts.get(2)).toBe(2)
    const retryUrls = FakeXMLHttpRequest.requests.filter((request) => request.url.includes('part-2-'))
    expect(retryUrls[0].url).not.toBe(retryUrls[1].url)
    expect(retryUrls[0].timeout).toBe(5 * 60 * 1000)
    const completion = api.post.mock.calls.find(([path]) => path.endsWith('/complete/'))
    expect(completion[1].parts.map((part) => part.part_number)).toEqual([1, 2])
    expect(progress).toHaveBeenLastCalledWith(100)
  })

  it('aborts the owned multipart session when the user cancels the active part', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    api.post.mockImplementation((path) => {
      if (path === '/student/multipart-uploads/') {
        return Promise.resolve({ data: { upload_id: 'session-cancel', part_size: 4, total_parts: 1 } })
      }
      if (path.includes('/parts/')) return Promise.resolve({ data: { url: 'https://private-bucket.t3.storage.dev/part' } })
      if (path.endsWith('/abort/')) return Promise.resolve({ status: 204 })
      throw new Error(`Unexpected POST ${path}`)
    })
    FakeXMLHttpRequest.prototype.send = function send() {
      FakeXMLHttpRequest.requests.push(this)
    }

    const controller = new AbortController()
    const file = new File(['abcd'], 'demo.mp4', { type: 'video/mp4' })
    const upload = uploadTigrisVideo(file, 31, { signal: controller.signal })
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1))
    controller.abort()

    await expect(upload).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.post).toHaveBeenCalledWith('/student/multipart-uploads/session-cancel/abort/', {}, { timeout: 15_000 })
  })
})
