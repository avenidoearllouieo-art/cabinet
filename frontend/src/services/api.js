import axios from 'axios'

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'

const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
})

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16)
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

function operationName(config) {
  const method = String(config?.method || 'get').toUpperCase()
  const rawUrl = String(config?.url || '').split(/[?#]/, 1)[0]
  let path = rawUrl
  if (/^https?:\/\//i.test(rawUrl)) {
    try { path = new URL(rawUrl).pathname } catch { path = '/api/request' }
  }
  return `${method} ${path || '/api/request'}`
}

const initialToken = localStorage.getItem('access')
const normalizedInitialToken = initialToken && initialToken !== 'undefined' && initialToken !== 'null' ? initialToken : null
if (normalizedInitialToken) {
  api.defaults.headers.common.Authorization = `Bearer ${normalizedInitialToken}`
}

api.interceptors.request.use(
  (config) => {
    const accessToken = localStorage.getItem('access')
    const normalizedToken = accessToken && accessToken !== 'undefined' && accessToken !== 'null' ? accessToken : null

    if (normalizedToken) {
      config.headers = {
        ...(config.headers || {}),
        Authorization: `Bearer ${normalizedToken}`,
      }
    }

    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      delete config.headers['Content-Type']
      delete config.headers['content-type']
    }

    const requestId = config._taptrackRequestId || createRequestId()
    config._taptrackRequestId = requestId
    config.headers['X-Request-ID'] = requestId
    console.debug('[API Request]', { operation: operationName(config), requestId })

    return config
  },
  (error) => {
    console.error('[API Request Error]', {
      operation: operationName(error?.config),
      status: error?.response?.status ?? null,
      exceptionType: error?.name || 'Error',
      requestId: error?.config?._taptrackRequestId || 'unavailable',
    })
    return Promise.reject(error)
  },
)

api.interceptors.response.use(
  (response) => {
    console.debug('[API Response]', {
      operation: operationName(response.config),
      status: response.status,
      requestId: response.config._taptrackRequestId,
    })
    return response
  },
  (error) => {
    console.error('[API Response Error]', {
      operation: operationName(error.config),
      status: error.response?.status ?? null,
      exceptionType: error.name || 'Error',
      requestId: error.config?._taptrackRequestId || error.response?.headers?.['x-request-id'] || 'unavailable',
    })

    if (error.response?.status === 401 && error.config?.url?.includes('/auth/login/') === false) {
      console.warn('[API] Authentication failed on protected endpoint; clearing stored access token.')
      localStorage.removeItem('access')
      localStorage.removeItem('refresh')
      localStorage.removeItem('user')
    }

    return Promise.reject(error)
  },
)

export default api
