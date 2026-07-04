import axios from 'axios'

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'

const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
})

const initialToken = localStorage.getItem('access')
const normalizedInitialToken = initialToken && initialToken !== 'undefined' && initialToken !== 'null' ? initialToken : null
if (normalizedInitialToken) {
  api.defaults.headers.common.Authorization = `Bearer ${normalizedInitialToken}`
  console.debug('[API] initialized Authorization header from storage')
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

    console.debug('[API Request]', {
      method: config.method?.toUpperCase(),
      url: `${config.baseURL || ''}${config.url}`,
      accessToken: normalizedToken ? 'present' : 'missing',
      headers: config.headers,
      data: config.data,
    })

    return config
  },
  (error) => {
    console.error('[API Request Error]', error)
    return Promise.reject(error)
  },
)

api.interceptors.response.use(
  (response) => {
    console.debug('[API Response]', {
      url: response.config.url,
      status: response.status,
      data: response.data,
    })
    return response
  },
  (error) => {
    console.error('[API Response Error]', {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
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
